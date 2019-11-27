class Popout {
	static onRenderJournalSheet(obj, html, data) {
		let element = html.find(".window-header .window-title")
		Popout.addPopout(obj.id, element)
	}
	static onRenderActorSheet(obj, html, data) {
		let element = html.find(".window-header .window-title")
		Popout.addPopout(obj.id, element, `
	    Hooks.on('ready', () => game.actors.get("${obj.actor.id}").sheet.render(true));
	    $("#popout-main-div").css("pointer-events", "none");
        `);
	}
	static addPopout(id, element, custom_script) {
		console.log("Adding popout to : ", element)
		// Can't find it?
		if (element.length != 1) {
			return;
		}
		let popout = $('<a class="popout" style><i class="fas fa-external-link-alt"></i>PopOut!</a>')
		popout.on('click', (event) => Popout.onPopoutClicked(event, id, custom_script))
		element.after(popout)

	}
	static onPopoutClicked(event, id, custom_script, cb) {
		let div = $(event.target).closest("div")
		let window_title = div.find(".window-title").text().trim()

		// Create a new html document
		let html = $("<html>")
		let head = $("<head>")
		let body = $("<body>")

		// Copy classes from html/head/body tags and add title
		html.attr("class", $("html").attr("class"))
		head.attr("class", $("head").attr("class"))
		head.append($("<title>" + window_title + "</title>"))
		body.attr("class", $("body").attr("class"))
		// Clone the journal sheet so we can modify it safely
		div = div.clone()
		// Avoid other apps with the same id from destroying this div
		div.attr("id", "popout-main-div")
		// Remove the buttons and forms because there are no JS hooks into them.
		div.find("header a,form button,form .form-group,.window-resizable-handle").remove()
		// Make sure any newly opened item doesn't get hidden behind it and set the size to the full window - padding.
		div.css({
			"z-index": "0",
			"width": "100%",
			"height": "100%",
			"top": "0",
			"left": "0",
			"padding": "15px",
		})
		body.append(div)
		html.append(head)
		html.append(body)

		// Copy the scripts and css so the sheet appears correctly
		for (let link of $("head link")) {
			let new_link = $(link).clone()
			// Replace the href with the full URL
			if (new_link.href != "")
				new_link.attr("href", link.href)
			head.append(new_link)
		}
		for (let script of $("head script,body script")) {
			let new_script = $(script).clone()
			// Replace the src with the full URL
			if (script.src != "")
				new_script.attr("src", script.src)
			head.append(new_script)
		}
		head.append($("<script>canvas = {};</script>"))
		if (custom_script) {
			body.append($("<script>" + custom_script + "</script>"))
		}
		// Avoid having the UI initialized which renders the chatlog and all sorts
		// of other things behind the sheet
		body.append($(`<script>
		      Game.prototype.initializeUI = function() {
				ui.nav = new SceneNavigation()
				ui.controls = new SceneControls();
				ui.notifications = new Notifications().render();
				ui.sidebar = new Sidebar()
				// sidebar elements only get created on the render
				// but we don't want to render them
				ui.chat = new ChatLog()
				ui.combat = new CombatTracker()
				ui.scenes = new SceneDirectory()
				ui.actors = new ActorDirectory()
				ui.items = new ItemDirectory()
				ui.journal = new JournalDirectory()
				ui.tables = new RollTableDirectory()
				ui.playlists = new PlaylistDirectory()
				ui.compendium = new CompendiumDirectory()
				ui.settings = new Settings()
				ui.players = new PlayerList()
				ui.pause = new Pause()
				ui.menu = new MainMenu();
		      }
		      window.dispatchEvent(new Event('load'))
		      </script>`))
		// Open new window and write the new html document into it
		// We need to open it to the same url because some images use relative paths
		let win = window.open(window.location.toString())
		//console.log(win)
		// This is for electron which doesn't have a Window but a BrowserWindowProxy
		if (win.document === undefined) {
			win.eval(`document.write(\`${html[0].outerHTML}\`); document.close();`)
		} else {
			win.document.write(html[0].outerHTML)
			// After doing a write, we need to do a document.close() so it finishes
			// loading and emits the load event.
			win.document.close()
		}
		if (cb != undefined) {
			cb(win)
		}
	}
}

Hooks.on('ready', () => {
	Hooks.on('renderJournalSheet', Popout.onRenderJournalSheet)
	// Hook to render on any actor sheets
	let sheets = []
	for (let type in CONFIG["Actor"].sheetClasses) {
		sheets = sheets.concat(Object.values(CONFIG["Actor"].sheetClasses[type]))
	}
	for (let sheet of sheets.map(s => s.cls.name)) {
		Hooks.on('render' + sheet, Popout.onRenderActorSheet)
	}
});
