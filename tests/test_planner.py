import copy
import unittest
from unittest.mock import patch
from app.sample import scenario
from app.planner import plan, validate, compare
from app.routing import matrix, geometry, decode_polyline


class PlannerTests(unittest.TestCase):
    def test_optimization_assigns_once_and_respects_capacity(self):
        data=scenario()
        baseline=plan(data)
        result=plan(data,True)
        self.assertEqual(result['unassigned'],[])
        self.assertEqual(result['warnings'],[])
        self.assertLessEqual(result['metrics']['trucks'],8)
        self.assertLess(result['metrics']['km'],baseline['metrics']['km'])
        stops=[s['id'] for r in result['routes'] for s in r['stops']]
        self.assertEqual(len(stops),len(set(stops)))
        self.assertEqual(len(stops),40)
        for route in result['routes']:
            self.assertLessEqual(route['pallets'],12)

    def test_unavailable_trucks_and_excess_demand(self):
        data=scenario()
        for t in data['trucks']: t['available']=False
        data['trucks'][0]['available']=True
        result=plan(data,True)
        self.assertEqual(result['metrics']['trucks'],1)
        self.assertTrue(result['unassigned'])
        self.assertEqual(result['routes'][0]['truck_id'],'T01')

    def test_impossible_window_is_unassigned(self):
        data=scenario();data['deliveries']=data['deliveries'][:2];data['assignments']={}
        data['deliveries'][0]['window_start']=0;data['deliveries'][0]['window_end']=1
        result=plan(data,True)
        self.assertIn('D001',result['unassigned'])
        self.assertNotIn('D002',result['unassigned'])

    def test_manual_overload_unavailable_late_shift(self):
        data=scenario();data['trucks'][0].update(capacity=1,available=False,shift_end=481)
        result=plan(data)
        self.assertTrue(any('Capacity exceeded' in w for w in result['warnings']))
        self.assertTrue(any('unavailable' in w for w in result['warnings']))
        self.assertTrue(any('shift' in w for w in result['warnings']))

    def test_waiting_and_service_propagate(self):
        data=scenario();data['deliveries']=data['deliveries'][:1]
        data['deliveries'][0].update(lat=data['depot']['lat'],lon=data['depot']['lon'],window_start=540)
        data['assignments']={'T01':['D001']}
        stop=plan(data)['routes'][0]['stops'][0]
        self.assertEqual(stop['arrival'],480)
        self.assertEqual(stop['service_start'],540)
        self.assertEqual(stop['departure'],555)
        self.assertEqual(stop['wait_minutes'],60)

    def test_validation(self):
        for mutate in [lambda d:d['assignments']['T02'].append('D001'),
                       lambda d:d['deliveries'][0].update(lat=float('nan')),
                       lambda d:d['trucks'][0].update(capacity=-1),
                       lambda d:d['settings'].update(max_trucks=2.5)]:
            data=scenario();mutate(data)
            with self.assertRaises(ValueError):validate(data)

    def test_modes_default_and_validation(self):
        data=scenario();del data['settings']['mode']
        self.assertEqual(validate(data)['settings']['mode'],'geographic')
        data['settings']['mode']='unknown'
        with self.assertRaises(ValueError):validate(data)

    def test_compare_reuses_matrix_and_preserves_input(self):
        data=scenario();data['deliveries']=data['deliveries'][:4];data['assignments']={}
        data['trucks']=data['trucks'][:2];data['settings']['max_trucks']=2
        # Two geographic pairs. Artificial travel costs favor crossing between them.
        for i,d in enumerate(data['deliveries']):
            d.update(lat=18.45+(i//2)*.03,lon=-69.93+(i%2)*.0001,service_minutes=0)
        for t in data['trucks']:t['capacity']=4
        seconds=[[0 if i==j else 100 for j in range(5)] for i in range(5)]
        seconds[1][3]=seconds[3][1]=seconds[2][4]=seconds[4][2]=1
        original=copy.deepcopy(data)
        with patch('app.planner.matrix',return_value=(seconds,seconds)) as mocked:
            results=compare(data)
        mocked.assert_called_once()
        self.assertEqual(data,original)
        for result in results.values():
            self.assertEqual(result['metrics']['trucks'],2)
            self.assertEqual(result['unassigned'],[])
            self.assertEqual(result['warnings'],[])
        self.assertEqual(results['geographic']['metrics']['nearby_pairs_split'],0)
        self.assertGreater(results['efficiency']['metrics']['nearby_pairs_split'],0)
        self.assertGreater(results['geographic']['metrics']['drive_minutes'],results['efficiency']['metrics']['drive_minutes'])
        # When capacity allows one truck, neither mode buys a second to save driving.
        for t in data['trucks']:t['capacity']=8
        with patch('app.planner.matrix',return_value=(seconds,seconds)):
            for result in compare(data).values():
                self.assertEqual(result['metrics']['trucks'],1)
                self.assertEqual(result['unassigned'],[])

    def test_time_factor_changes_times_not_distance(self):
        data=scenario();a=plan(data);data['settings']['time_factor']=2;b=plan(data)
        self.assertEqual(a['metrics']['km'],b['metrics']['km'])
        self.assertAlmostEqual(b['metrics']['drive_minutes'],2*a['metrics']['drive_minutes'],delta=8)

    def test_valhalla_contract_preserves_direction(self):
        points=[{'lat':18.4,'lon':-69.9},{'lat':18.5,'lon':-69.8}]
        response={'sources_to_targets':[[{'time':0,'distance':0},{'time':600,'distance':5}],
                                       [{'time':900,'distance':7},{'time':0,'distance':0}]]}
        with patch('app.routing.call_valhalla',return_value=response):
            seconds,km=matrix(points,'valhalla',1.3)
        self.assertEqual(seconds[0][1],780)
        self.assertEqual(seconds[1][0],1170)
        self.assertEqual(km[1][0],7)

    def test_unreachable_road_does_not_become_a_straight_line(self):
        with patch('app.routing.call_valhalla',return_value={'sources_to_targets':[[{'time':None,'distance':None}]]}):
            with self.assertRaises(ValueError):matrix([{'lat':0,'lon':0}],'valhalla',1)

    def test_polyline_precision_six(self):
        self.assertEqual(decode_polyline('??_c`|@_gayB'),[[0,0],[1,2]])

if __name__=='__main__': unittest.main()
