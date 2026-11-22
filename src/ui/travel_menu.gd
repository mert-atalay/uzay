class_name TravelMenu
extends PanelContainer
## Tab opens a list of every star system and body; pick one to jump next to it.
## (A stand-in for real warp travel, which comes with the interstellar milestone.)

signal closed

var space_view: SpaceView
var _tree: Tree


func _ready() -> void:
	visible = false
	custom_minimum_size = Vector2(380, 560)
	var box := VBoxContainer.new()
	add_child(box)
	var title := Label.new()
	title.text = "TRAVEL TO   (Tab / Start to close)"
	title.add_theme_font_size_override("font_size", 14)
	box.add_child(title)
	_tree = Tree.new()
	_tree.hide_root = true
	_tree.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_tree.item_activated.connect(_on_activated)
	_tree.item_mouse_selected.connect(func(_pos: Vector2, _button: int) -> void: _on_selected())
	box.add_child(_tree)
	var hint := Label.new()
	hint.text = "Click a destination, or move with the D-pad / arrows and press A / Enter. B / Esc closes."
	hint.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	hint.add_theme_font_size_override("font_size", 11)
	hint.modulate = Color(1, 1, 1, 0.6)
	box.add_child(hint)


func open() -> void:
	_rebuild()
	visible = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	_tree.grab_focus()
	space_view.player.input_blocked = true
	# Start on the first system row so a controller or the arrow keys have somewhere to move from.
	var first := _tree.get_root().get_first_child()
	for item in _tree.get_root().get_children():
		if not item.collapsed:
			first = item
	if first != null:
		first.select(0)
		_tree.scroll_to_item(first)


func close() -> void:
	visible = false
	space_view.player.input_blocked = false
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED
	closed.emit()


func _rebuild() -> void:
	_tree.clear()
	var root := _tree.create_item()
	var catalog := Universe.catalog
	for s in catalog.systems:
		var sys_item := _tree.create_item(root)
		var dist: float = s["distance_ly"]
		sys_item.set_text(0, "%s   %s" % [s["name"], ("home" if dist == 0.0 else "%s ly" % dist)])
		sys_item.collapsed = s["id"] != space_view.player.system_id
		_add_children(sys_item, s["id"], null, 0)


func _add_children(parent_item: TreeItem, system_id: String, parent_id: Variant, depth: int) -> void:
	for b in Universe.catalog.bodies_in_system(system_id):
		if b["parent"] != parent_id:
			continue
		var item := _tree.create_item(parent_item)
		item.set_text(0, b["name"])
		item.set_metadata(0, b["id"])
		_add_children(item, system_id, b["id"], depth + 1)
		if depth >= 1:
			item.collapsed = true


func _on_selected() -> void:
	var item := _tree.get_selected()
	if item != null and item.get_metadata(0) != null:
		space_view.warp_to(item.get_metadata(0))
		close()


## Enter, controller A or a double click: go there, or open/close a star system row.
func _on_activated() -> void:
	var item := _tree.get_selected()
	if item == null:
		return
	if item.get_metadata(0) != null:
		_on_selected()
	else:
		item.collapsed = not item.collapsed


func _input(event: InputEvent) -> void:
	if visible and event.is_action_pressed("ui_cancel"):
		get_viewport().set_input_as_handled()
		close()
