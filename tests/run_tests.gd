extends SceneTree
## Headless test runner. Usage:
##   godot --headless --import            (once, builds the class cache)
##   godot --headless -s res://tests/run_tests.gd
## Runs every test_*() method in every res://tests/test_*.gd file. Exits 1 on any failure.


func _initialize() -> void:
	var total := 0
	var failed := 0
	var dir := DirAccess.open("res://tests")
	var files := Array(dir.get_files()).filter(func(f): return f.begins_with("test_") and f.ends_with(".gd") and f != "test_case.gd")
	files.sort()
	for file in files:
		var script: GDScript = load("res://tests/" + file)
		for method in script.get_script_method_list():
			var name: String = method["name"]
			if not name.begins_with("test_"):
				continue
			var tc: TestCase = script.new()
			tc.call(name)
			total += 1
			if tc.failures.is_empty():
				print("  ok    %s::%s" % [file, name])
			else:
				failed += 1
				print("  FAIL  %s::%s" % [file, name])
				for f in tc.failures:
					print("        - " + f)
	print("\n%d tests, %d failed" % [total, failed])
	quit(1 if failed > 0 else 0)
