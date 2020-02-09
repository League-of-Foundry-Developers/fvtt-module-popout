class PopoutModule {
	static onRenderJournalSheet(obj, html, data) {
		let element = html.find(".window-header .window-title")
		PopoutModule.addPopout(element, `game.journal.get("${obj.entity.id}").sheet`);
	}
	static onRenderActorSheet(obj, html, data) {
		let element = html.find(".window-header .window-title")
		PopoutModule.addPopout(element, `game.actors.get("${obj.entity.id}").sheet`);
	}
	static addPopout(element, sheet) {
		// Can't find it?
		if (element.length != 1) {
			return;
		}
		let popout = $('<a class="popout" style><i class="fas fa-external-link-alt"></i>PopOut!</a>')
		popout.on('click', (event) => PopoutModule.onPopoutClicked(event, sheet))
		element.after(popout)

	}
	static onPopoutClicked(event, sheet) {
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
		/*
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
		body.append(div)*/
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
		// Create a callable canvas with a universal proxy so canvas.notes.placeables.filter() doesn't crash on journal updates.
		head.append($("<script>handlers = {get: (obj, name) => {if (name === 'length') return 0; return canvas;}, set: () => true}; canvas = new Proxy(() => canvas, handlers);</script>"))
		// Avoid having the UI initialized which renders the chatlog and all sorts
		// of other things behind the sheet
		body.append($(`<script>
		      Game.prototype.initializeUI = function() {
							ui.nav = new SceneNavigation();
							ui.controls = new SceneControls();
							ui.notifications = new Notifications().render();
							ui.sidebar = new Sidebar();
							// Back to initializeUI 
							ui.players = new PlayerList();
							ui.hotbar = new Hotbar();
							ui.webrtc = new CameraViews(this.webrtc);
							ui.pause = new Pause();
							ui.menu = new MainMenu();

							// sidebar elements only get created on the render
							// but we don't want to render them
							ui.chat = new ChatLog({tabName: "chat"})
							ui.combat = new CombatTracker({tabName: "combat"})
							ui.scenes = new SceneDirectory({tabName: "scenes"})
							ui.actors = new ActorDirectory({tabName: "actors"})
							ui.items = new ItemDirectory({tabName: "items"})
							ui.journal = new JournalDirectory({tabName: "journal"})
							ui.tables = new RollTableDirectory({tabName: "tables"})
							ui.playlists = new PlaylistDirectory({tabName: "playlists"})
							ui.compendium = new CompendiumDirectory({tabName: "compendium"})
							ui.settings = new Settings({tabName: "settings"})
					}
							
				KeyboardManager.prototype._onEscape = function(event, up, modifiers) {
					if ( up || modifiers.hasFocus ) return;

					// Case 1 - dismiss an open context menu
					if ( ui.context && ui.context.menu.length ) ui.context.close();

					// Case 2 - close open UI windows
					else if ( Object.keys(ui.windows).length ) {
						Object.values(ui.windows).filter(w => w.id !== ${sheet}.id).forEach(app => app.close());
					}

					// Flag the keydown workflow as handled
					this._handled.add(event.keyCode);
				}
			  Hooks.on('ready', () => PopoutModule.renderPopout(${sheet}));
		      window.dispatchEvent(new Event('load'))
		      </script>`))
		// Open new window and write the new html document into it
		// We need to open it to the same url because some images use relative paths
		let win = window.open(window.location.toString())
		//console.log(win)
		// This is for electron which doesn't have a Window but a BrowserWindowProxy
		// Need to specify DOCTYPE so the browser is in standards mode (fixes TinyMCE and CSS)
		html = "<!DOCTYPE html>" +  html[0].outerHTML
		if (win.document === undefined) {
			win.eval(`document.write(\`${html}\`); document.close();`)
		} else {
			win.document.write(html)
			// After doing a write, we need to do a document.close() so it finishes
			// loading and emits the load event.
			win.document.close()
		}
	}

	static renderPopout(sheet) {
		sheet.options.minimizable = false;
		sheet.options.resizable = false;
		sheet.options.id = "popout-" + sheet.id;
		sheet.options.closeOnSubmit = false;
		// Without setting the id, re-rendering the sheet unmaximizes it and custom classes for CSS (shadowrun) don't get set.
		Object.defineProperty(sheet, 'id', { value: sheet.options.id, writable: true, configurable: true });
		// Replace the render function so if it gets re-rendered (such as switching journal view mode), we can
		// re-maximize it.
		sheet._original_popout_render = sheet._render
		sheet._render = async function (force, options) {
			await this._original_popout_render(true, options);
			// Maximum it
			sheet.element.css({ width: "100%", height: "100%", top: "0px", left: "0px", padding: "15px" })
			// Remove the close and popout buttons
			sheet.element.find("header .close, header .popout").remove()
		}
		sheet.render(true);
	}
}

Hooks.on('ready', () => {
	Hooks.on('renderJournalSheet', PopoutModule.onRenderJournalSheet)
	Hooks.on('renderActorSheet', PopoutModule.onRenderActorSheet)
});
