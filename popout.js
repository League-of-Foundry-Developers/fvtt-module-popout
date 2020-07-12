

class PopoutModule {
	static log(msg, ...args) {
		if (game && game.settings.get("popout", "verboseLogs")) {
			const color = "background: #6699ff; color: #000; font-size: larger;";
			console.debug(`%c PopoutModule: ${msg}`, color, ...args);
		}
	}

	static async init() {
		game.settings.register("popout", "useWindows", {
			name: "Pop sheets out into windows",
			hint: "Force the popped out sheet to be a window with minimal decorations. Otherwise uses your browser's default (a new tab most likely)",
			scope: "client",
			config: true,
			default: false,
			type: Boolean
		});

		game.settings.register("popout", "verboseLogs", {
			name: "Enable more module logging.",
			hint: "Enables more verbose module logging. This is useful for debugging the module. But otherwise should be left off.",
			scope: "client",
			config: true,
			default: false,
			type: Boolean
		});

		// Ideally there is a better way to enumerate hooks.
		// or at least book the core application. But I guess that is an
		// argument that this should be part of core, foundry.
		const hookPoints = [
			"renderFrameViewer",
			"renderSettingsViewer",
			"renderMacroConfig",
			"renderModuleManagement",
			"renderSceneConfig",
			"renderRollTableConfig",
			"renderJournalSheet", 
			"renderItemSheet",
			"renderCompendium",
			"renderActorSheet",
		]

		for (const hook of hookPoints) {
			Hooks.on(hook, this.addPopout.bind(this));
		}

		this.log("Attached popout hooks", hookPoints);

		// HACK(aposney: 2020-07-12): we need to init tinymce to ensure it's plugins 
		// are loaded into the frame. Otherwise our popouts will not be able to access
		// the lazy loaded javascript mce plugins. 
		const elem = $("<div style=\"display: none;\"><p id=\"mce_init\"> foo </p></div>")
		$('body').append(elem)
		const config = {target: elem[0], plugins: CONFIG.TinyMCE.plugins};
		const editor = await tinyMCE.init(config);
		editor[0].remove();
	}

	static addPopout(app, node, data) {
		this.log("testing");
		// We can ignore node and data since we aren't planning on re-rendering
		// the app, so the original element attached to the app is enough.
		try {
			return this._addPopout(app);
		} catch(err) {
			this.log(err);
			throw err;
		}
	}

	static _addPopout(app) {
		if (!app.popOut) {
			return;
		}
		const ID = "d25c3971"; // Random ID to avoid collisions.
		const domID = `popout_${this.ID}_${app.appId}`;
		if (!document.getElementById(domID)) { // Don't create a second link on re-renders;
			this.log("Attached", app);
			const link = $(`<a id="${domID}"><i class="fas fa-external-link-alt"></i>PopOut!</a>`)
			link.on('click', () => this.onPopoutClicked(app));
			app.element.find('.window-title').after(link);
		}
	}


	static onPopoutClicked(app) {
		// Check if popout in Electron window
		if (navigator.userAgent.toLowerCase().indexOf(" electron/") !== -1) {
			ui.notifications.warn("Popout! cannot work within the standalone FVTT Application. Please open your game from a regular browser.");
			return;
		}

		// Store original position for later use.
		const appPosition = {...app.position};

        // Hide the original node;
		const appNode = app.element[0];
		appNode.style.display = "none";

        // Create the new document.
        // Currently using raw js apis, since I need to ensure
        // jquery isn't doing something sneaky underneath.
        // In particular it makes some assumptions about there
        // being a single document.
        // We do this before opening the window because technically writing
        // to the new window is race condition with the page load.
        // But since we are directing to a 404, it doesn't matter other than for UX purposes.
		const html = document.createElement("html");
		const serializer = new XMLSerializer();
		const doctype = serializer.serializeToString(document.doctype);
		const head = document.importNode(document.getElementsByTagName("head")[0], true);
		const body = document.importNode(document.getElementsByTagName("body")[0], false);

		// Remove script tags from cloned head.
		for (const child of [...head.children]) {
			if (child.nodeName === "SCRIPT") {
				child.remove();
			}
		}

		html.appendChild(head);
		html.appendChild(body);

		// Document created.

		let windowFeatures = undefined;
		if (game.settings.get("popout", "useWindows")) {
			const padding = 30;
            const innerWidth = app.element.innerWidth() + padding * 2;
            const innerHeight = app.element.innerHeight() + padding * 2;
            const position = app.element.position;
            const left = window.screenX + position.left - padding;
            const top = window.screenY + position.top - padding;
            windowFeatures = `toolbar=0, location=0, menubar=0, titlebar=0, scrollbars=1, innerWidth=${innerWidth}, innerHeight=${innerHeight}, left=${left}, top=${top}`;
        }

        const dest = window.origin + '/__popout' // Deliberate 404
		const popout = window.open(dest, '_blank', windowFeatures);

		this.log("Window opened", dest, popout);

		if (!popout) {
			appNode.style.display = "revert"; // If we failed to open the window, show the app again.
			appNode._minimized = false;
			ui.notifications.warn(`Unable to open PopOut! window. Please check your site settings/permissions. Click the <i class="fas fa-info-circle"></i> to the left of the website URL.`);
			return;
		}


		const doc = popout.document;
		doc.open();
		doc.write(doctype);
		doc.write(html.outerHTML);
		doc.close();
		doc.title = app.title;

		window.addEventListener("beforeunload", async () => {
			await popout.close();
		});

		popout.addEventListener("beforeunload", async () => {
			this.log("Clossing popout", app.title);
			app.position = appPosition; // Set the original position.
			await app.close();
			await popout.close();
			// TODO: PopIn.
			// Need to save the original location and position and reset that before closing.
			// But probably not worth the effort.
		});

		// We wait longer than just the DOMContentLoaded
		// because of how the document is constructed manually.
		popout.addEventListener("load", async (event) => {
			const wrapper = event.target.getElementById(appNode.id);
			const body = event.target.getElementsByTagName("body")[0];
			const node = doc.adoptNode(appNode);

			body.append(node);

			const toRemove = [".window-header", ".window-resizable-handle"];

			for (const selector of toRemove) {
				const elem = node.querySelector(selector);
				if (elem) {
					elem.remove();
				}
			}
			appNode.style.cssText = "display: flex; top: 0; left: 0; width: 100%; height: 100%"; // Fullscreen
			app.setPosition({width: '100%', height: '100%', top: 0, left: 0});
			this.log("Final Node", node, app);
		});
	}
}


Hooks.on('ready', async () => {
	PopoutModule.init();
});
