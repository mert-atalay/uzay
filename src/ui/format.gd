class_name Fmt
extends RefCounted
## Human-readable distances, speeds and times.

const AU := 149597870700.0
const LY := 9460730472580800.0
const C := 299792458.0


static func distance(m: float) -> String:
	if m < 1000.0:
		return "%.0f m" % m
	if m < 1.0e7:
		return "%s km" % _group(m / 1000.0)
	if m < 0.05 * AU:
		return "%s km" % _group(m / 1000.0)
	if m < 0.2 * LY:
		return "%.2f AU" % (m / AU)
	return "%.2f ly" % (m / LY)


static func speed(mps: float) -> String:
	if mps < 1000.0:
		return "%.1f m/s" % mps
	if mps < 0.01 * C:
		return "%.1f km/s" % (mps / 1000.0)
	return "%.2f c" % (mps / C)


static func time_scale(s: float) -> String:
	if s == 0.0:
		return "paused"
	if s < 60.0:
		return "%.0f×" % s
	if s < 3600.0:
		return "1 min/s"
	if s < 86400.0:
		return "1 hour/s"
	return "1 day/s"


static func _group(v: float) -> String:
	var s := "%d" % int(round(v))
	var out := ""
	var n := s.length()
	for i in n:
		out += s[i]
		var left := n - i - 1
		if left > 0 and left % 3 == 0:
			out += ","
	return out


## A span of time in the largest sensible unit: "1.02 hours", "3.4 days", "12 years".
static func duration(seconds: float) -> String:
	var hours := seconds / 3600.0
	if hours < 48.0:
		return "%.2f hours" % hours
	var days := hours / 24.0
	if days < 730.0:
		return "%.1f days" % days
	return "%s years" % String.num(days / 365.25, 1)
