"""Single-depot, delivery-only VRP: pallets, windows, shifts, optional dropped stops."""
import math
from copy import deepcopy
from .routing import matrix, geometry


def validate(data):
    if not isinstance(data, dict):
        raise ValueError('Scenario must be a JSON object.')
    def number(value, label, low, high):
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f'{label} must be between {low} and {high}.')
    deliveries, trucks = data.get('deliveries',[]), data.get('trucks',[])
    if not isinstance(deliveries,list) or not isinstance(trucks,list) or not 1 <= len(deliveries) <= 100 or not 1 <= len(trucks) <= 20:
        raise ValueError('Use 1–100 deliveries and 1–20 trucks.')
    for collection in [deliveries,trucks]:
        if any(not isinstance(item,dict) for item in collection): raise ValueError('Each delivery/truck must be an object.')
        ids = [item.get('id') for item in collection]
        if any(not isinstance(i,str) or not i or len(i)>80 for i in ids) or len(ids)!=len(set(ids)):
            raise ValueError('Delivery and truck IDs must be unique nonempty strings.')
    for point in [data['depot']]+deliveries:
        if not isinstance(point,dict): raise ValueError('Locations must be objects.')
        number(point['lat'],'Latitude',-90,90)
        number(point['lon'],'Longitude',-180,180)
    for item in [data['depot']]+deliveries+trucks:
        if not isinstance(item.get('name'),str) or not 1<=len(item['name'])<=200: raise ValueError('Each item needs a name of 1–200 characters.')
    for d in deliveries:
        number(d['pallets'],'Pallets',1,1000)
        if int(d['pallets']) != d['pallets']: raise ValueError('Pallets must be whole numbers.')
        number(d['service_minutes'],'Service duration',0,240)
        number(d['window_start'],'Window start',0,1439)
        number(d['window_end'],'Window end',d['window_start'],1440)
    for t in trucks:
        if not isinstance(t['available'],bool): raise ValueError('Truck availability must be true or false.')
        number(t['capacity'],'Truck capacity',1,1000)
        if int(t['capacity']) != t['capacity']: raise ValueError('Capacity must be whole pallets.')
        number(t['shift_start'],'Shift start',0,1439)
        number(t['shift_end'],'Shift end',t['shift_start'],1440)
    settings = data['settings']
    if not isinstance(settings,dict): raise ValueError('Settings must be an object.')
    if settings['provider'] not in ['offline','valhalla']: raise ValueError('Unknown routing provider.')
    settings.setdefault('mode','geographic')
    if settings['mode'] not in ['geographic','efficiency']: raise ValueError('Unknown optimization mode.')
    number(settings['time_factor'],'Simulated travel-time factor',1,3)
    number(settings['max_trucks'],'Maximum active trucks',1,len(trucks))
    if int(settings['max_trucks']) != settings['max_trucks']: raise ValueError('Maximum trucks must be a whole number.')
    assignments = data.get('assignments',{})
    if not isinstance(assignments,dict): raise ValueError('Assignments must be an object keyed by truck ID.')
    seen = set()
    for truck, stops in assignments.items():
        if truck not in {t['id'] for t in trucks} or not isinstance(stops,list): raise ValueError('Invalid truck assignment.')
        for stop in stops:
            if stop not in {d['id'] for d in deliveries} or stop in seen: raise ValueError('Unknown or duplicate delivery assignment.')
            seen.add(stop)
    return data


def nearby_pairs(deliveries):
    """Soft proximity preference; no dependence on customer names or sample districts."""
    pairs = []
    for i,a in enumerate(deliveries):
        for j in range(i+1,len(deliveries)):
            b = deliveries[j]
            lat1,lat2 = math.radians(a['lat']),math.radians(b['lat'])
            h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(math.radians(b['lon']-a['lon'])/2)**2
            km = 6371*2*math.asin(math.sqrt(min(1,h)))
            if km < .8:
                pairs.append((i,j,max(1,round(900*(1-km/.8)))))
    return pairs


def compare(data):
    data = validate(deepcopy(data))
    travel = matrix([data['depot']]+data['deliveries'],data['settings']['provider'],data['settings']['time_factor'])
    results = {}
    for mode in ['geographic','efficiency']:
        candidate = deepcopy(data)
        candidate['settings']['mode'] = mode
        results[mode] = plan(candidate,True,travel)
    return results


def optimize(data, seconds):
    from ortools.constraint_solver import pywrapcp, routing_enums_pb2
    deliveries = data['deliveries']
    trucks = [t for t in data['trucks'] if t['available']]
    if not trucks: raise ValueError('Make at least one truck available before optimizing.')
    manager = pywrapcp.RoutingIndexManager(len(deliveries)+1,len(trucks),0)
    routing = pywrapcp.RoutingModel(manager)
    services = [0]+[round(d['service_minutes']*60) for d in deliveries]
    def transit(a,b):
        x,y = manager.IndexToNode(a),manager.IndexToNode(b)
        return seconds[x][y]+services[x]
    callback = routing.RegisterTransitCallback(transit)
    routing.SetArcCostEvaluatorOfAllVehicles(callback)
    pairs = nearby_pairs(deliveries) if data['settings'].get('mode','geographic') == 'geographic' else []
    # Lexicographic objective encoded with safe bounds: serve stops, use fewer
    # trucks, then improve travel/cohesion. Search is still time-limited.
    secondary_bound = max(max(row) for row in seconds)*(len(deliveries)+len(trucks)) + sum(services) + sum(cost for _,_,cost in pairs)
    vehicle_cost = secondary_bound+1
    drop_cost = vehicle_cost*len(trucks)+secondary_bound+1
    routing.SetFixedCostOfAllVehicles(vehicle_cost)
    for a,b,cost in pairs:
        routing.AddSoftSameVehicleConstraint([manager.NodeToIndex(a+1),manager.NodeToIndex(b+1)],cost)
    routing.SetMaximumNumberOfActiveVehicles(int(data['settings']['max_trucks']))
    demand = [0]+[int(d['pallets']) for d in deliveries]
    cap = routing.RegisterUnaryTransitCallback(lambda i:demand[manager.IndexToNode(i)])
    routing.AddDimensionWithVehicleCapacity(cap,0,[int(t['capacity']) for t in trucks],True,'Capacity')
    routing.AddDimension(callback,86400,86400,False,'Time')
    time = routing.GetDimensionOrDie('Time')
    for i,d in enumerate(deliveries,1):
        idx = manager.NodeToIndex(i)
        time.CumulVar(idx).SetRange(round(d['window_start']*60),round(d['window_end']*60))
        routing.AddDisjunction([idx],drop_cost)
    for v,t in enumerate(trucks):
        start,end = round(t['shift_start']*60),round(t['shift_end']*60)
        time.CumulVar(routing.Start(v)).SetRange(start,start)
        time.CumulVar(routing.End(v)).SetRange(start,end)
        routing.AddVariableMinimizedByFinalizer(time.CumulVar(routing.End(v)))
    search = pywrapcp.DefaultRoutingSearchParameters()
    search.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PARALLEL_CHEAPEST_INSERTION
    search.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    search.time_limit.seconds = 3
    solution = routing.SolveWithParameters(search)
    if solution is None: raise ValueError('No plan found within the search limit. Check shifts and constraints.')
    assignments = {}
    for v,t in enumerate(trucks):
        idx, stops = routing.Start(v),[]
        while not routing.IsEnd(idx):
            node = manager.IndexToNode(idx)
            if node: stops.append(deliveries[node-1]['id'])
            idx = solution.Value(routing.NextVar(idx))
        if stops: assignments[t['id']]=stops
    return assignments


def plan(data, do_optimize=False, travel=None):
    validate(data)
    points = [data['depot']]+data['deliveries']
    seconds,km = travel if travel is not None else matrix(points,data['settings']['provider'],data['settings']['time_factor'])
    assignments = optimize(data,seconds) if do_optimize else data.get('assignments',{})
    by_id = {d['id']:(i+1,d) for i,d in enumerate(data['deliveries'])}
    routes, assigned, warnings = [],set(),[]
    for truck in data['trucks']:
        ids = assignments.get(truck['id'],[])
        if not ids: continue
        current,previous,distance,driving,load = truck['shift_start']*60,0,0,0,0
        stops,route_warnings,path = [],[],[points[0]]
        if not truck['available']: route_warnings.append('Truck is unavailable.')
        for id in ids:
            index,d = by_id[id]
            travel = seconds[previous][index]
            arrival = current+travel
            begin = max(arrival,d['window_start']*60)
            late = max(0,begin-d['window_end']*60)
            if late: route_warnings.append(f'{id}: service begins {math.ceil(late/60)} min after receiving window.')
            current = begin+d['service_minutes']*60
            stops.append(dict(id=id,arrival=round(arrival/60),service_start=round(begin/60),
                departure=round(current/60),wait_minutes=round((begin-arrival)/60),late_minutes=math.ceil(late/60)))
            driving+=travel; distance+=km[previous][index]; load+=d['pallets']
            previous=index; assigned.add(id); path.append(d)
        driving+=seconds[previous][0]; distance+=km[previous][0]; current+=seconds[previous][0]
        if load>truck['capacity']: route_warnings.append(f'Capacity exceeded: {load}/{truck["capacity"]} pallets.')
        if current>truck['shift_end']*60: route_warnings.append('Return is after the driver shift ends.')
        path.append(points[0])
        routes.append(dict(truck_id=truck['id'],stops=stops,km=round(distance,2),
            drive_minutes=round(driving/60),end=math.ceil(current/60),pallets=load,
            warnings=route_warnings,geometry=geometry(path,data['settings']['provider'])))
    if len(routes)>data['settings']['max_trucks']: warnings.append('Plan exceeds the maximum active trucks setting.')
    unassigned = [d['id'] for d in data['deliveries'] if d['id'] not in assigned]
    warnings.extend(f'{r["truck_id"]}: {w}' for r in routes for w in r['warnings'])
    owners = {id:truck for truck,ids in assignments.items() for id in ids}
    pairs = [(data['deliveries'][a]['id'],data['deliveries'][b]['id']) for a,b,_ in nearby_pairs(data['deliveries'])]
    served_pairs = [(a,b) for a,b in pairs if a in owners and b in owners]
    return dict(mode=data['settings']['mode'],assignments=assignments,routes=routes,unassigned=unassigned,warnings=warnings,
        metrics=dict(km=round(sum(r['km'] for r in routes),2),drive_minutes=sum(r['drive_minutes'] for r in routes),
            trucks=len(routes),assigned=len(assigned),nearby_pairs=len(served_pairs),
            nearby_pairs_split=sum(owners[a]!=owners[b] for a,b in served_pairs)),
        provider=data['settings']['provider'],time_factor=data['settings']['time_factor'],
        traffic='No historical or live traffic feed. Any multiplier is a simulation.',
        unassigned_reason='Not assigned; capacity, shifts, windows, fleet limit or time-limited search may prevent inclusion.')
