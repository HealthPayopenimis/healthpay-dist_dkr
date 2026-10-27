#!/usr/bin/env python3
"""Pure unit tests for target_sampler helpers; no Django, database, or /proc access."""

import unittest

from target_sampler import memory_metrics, normalized_cpu_percent, pressure_predicates


class TargetSamplerHelpersTest(unittest.TestCase):
    def test_normalized_cpu_and_iowait_from_injected_proc_fixtures(self):
        previous = {"user": 100, "nice": 0, "system": 50, "idle": 800, "iowait": 50, "irq": 0, "softirq": 0, "steal": 0}
        current = {"user": 130, "nice": 0, "system": 70, "idle": 820, "iowait": 60, "irq": 0, "softirq": 0, "steal": 0}
        busy, iowait = normalized_cpu_percent(previous, current)
        self.assertEqual((busy, iowait), (75.0, 12.5))

    def test_zero_or_nonforward_cpu_delta_is_safe(self):
        fixture = {"user": 1, "nice": 0, "system": 1, "idle": 1, "iowait": 0, "irq": 0, "softirq": 0, "steal": 0}
        self.assertEqual(normalized_cpu_percent(fixture, fixture), (0.0, 0.0))

    def test_memory_metrics_uses_injected_kib_values(self):
        self.assertEqual(
            memory_metrics({"MemTotal": 1_000_000, "MemAvailable": 95_000}),
            {"mem_total_kib": 1_000_000, "mem_available_kib": 95_000, "mem_available_ratio": 0.095},
        )

    def test_memory_metrics_zero_total_is_safe(self):
        self.assertEqual(
            memory_metrics({"MemTotal": 0, "MemAvailable": 10}),
            {"mem_total_kib": 0, "mem_available_kib": 10, "mem_available_ratio": 0.0},
        )

    def test_pressure_boundaries_and_sustained_cpu_note(self):
        self.assertEqual(
            pressure_predicates(85.0, 0.10, 20, 25),
            {"cpu_over_85": False, "mem_available_under_10pct": False, "db_connections_over_80pct": False},
        )
        self.assertEqual(
            pressure_predicates(85.01, 0.099, 21, 25),
            {"cpu_over_85": True, "mem_available_under_10pct": True, "db_connections_over_80pct": True},
        )

    def test_pressure_has_no_db_ceiling_flag_when_ceiling_is_zero(self):
        result = pressure_predicates(0, 1, 1, 0)
        self.assertFalse(result["db_connections_over_80pct"])


if __name__ == "__main__":
    unittest.main()
