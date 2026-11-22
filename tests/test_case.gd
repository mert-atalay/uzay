class_name TestCase
extends RefCounted
## Tiny assertion helpers for the headless test runner (tests/run_tests.gd).

var failures: Array[String] = []


func check(condition: bool, message: String) -> void:
	if not condition:
		failures.append(message)


func check_near(actual: float, expected: float, tolerance: float, message: String) -> void:
	if absf(actual - expected) > tolerance:
		failures.append("%s: expected %s ± %s, got %s" % [message, expected, tolerance, actual])


func check_rel(actual: float, expected: float, rel_tolerance: float, message: String) -> void:
	check_near(actual, expected, absf(expected) * rel_tolerance, message)
