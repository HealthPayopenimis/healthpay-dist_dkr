import unittest
from supervise import safety_abort, percentile
class SafetyTests(unittest.TestCase):
 def test_healthy(self):self.assertIsNone(safety_abort([],100,10,99,None,0))
 def test_monitor_loss(self):self.assertEqual(safety_abort([],100,10,79,None,0),'TARGET_MONITOR_STALE')
 def test_sustained_cpu(self):self.assertEqual(safety_abort([],100,10,99,69,0),'TARGET_CPU_SUSTAINED')
 def test_health_failures(self):self.assertEqual(safety_abort([],100,10,99,None,2),'TARGET_HEALTH_CONSECUTIVE_FAILURE')
 def test_error_window(self):self.assertEqual(safety_abort([(99,'unexpected_failure',1)]*10,100,31,99,None,0),'ROLLING_UNEXPECTED_FAILURE')
 def test_delay_window(self):self.assertEqual(safety_abort([(99,'total_request_ms',2500)]*10,100,31,99,None,0),'ROLLING_P95_EXCEEDED')
 def test_grace(self):self.assertIsNone(safety_abort([(99,'total_request_ms',2500)]*10,100,20,99,None,0))
 def test_late_window_not_masked(self):self.assertEqual(safety_abort([(1,'total_request_ms',1)]*100+[(99,'total_request_ms',2500)]*10,100,31,99,None,0),'ROLLING_P95_EXCEEDED')
 def test_percentile(self):self.assertEqual(percentile([1,2,3],.5),2)
if __name__=='__main__':unittest.main()
