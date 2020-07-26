class PopoutModule {
    constructor() {
        this.poppedOut = new Map();
        this.TIMEOUT_INTERVAL = 25 // ms
        this.MAX_TIMEOUT = 250; // ms
        // Random id to prevent collision with other modules;
        this.ID = [...Array(24)].map(() => Math.floor(Math.random() * 16).toString(16)).join("");
    }

    log(msg, ...args) {
        if (game && game.settings.get("popout", "verboseLogs")) {
            const color = "background: #6699ff; color: #000; font-size: larger;";
            console.debug(`%c PopoutModule: ${msg}`, color, ...args);
        }
    }

    async init() {
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


        // We replace the games window registry with a proxy object so we can intercept
        // every new application window creation event.
        const handler = {
            set: (obj, prop, value) => {
                const result = Reflect.set(obj, prop, value);
                this.log("Intercept ui-window create", value)
                try {
                    if (value && value.options && value.options.popOut) {
                        this.addPopout(value);
                    }
                } catch (err) {
                    // We must never fail here.
                    this.log(err);
                }
                return result
            }
        };
        ui.windows = new Proxy(ui.windows, handler);
        this.log("Installed window interceptor", ui.windows);

        // HACK(aposney: 2020-07-12): we need to init tinymce to ensure it's plugins 
        // are loaded into the frame. Otherwise our popouts will not be able to access
        // the lazy loaded javascript mce plugins. 
        const elem = $("<div style=\"display: none;\"><p id=\"mce_init\"> foo </p></div>")
        $("body").append(elem)
        const config = { target: elem[0], plugins: CONFIG.TinyMCE.plugins };
        const editor = await tinyMCE.init(config);
        editor[0].remove();
    }

    addPopout(app) {
        this._addPopout(app, 0);
    }


    _addPopout(app, recurse) {
        if (recurse > this.MAX_TIMEOUT) {
            this.log("Timeout out waiting for app to render");
            return;
        }

        if (!(app._state == Application.RENDER_STATES.RENDERED)) {
            window.setTimeout(() => {
                this._addPopout(app, recurse + this.TIMEOUT_INTERVAL);
            }, this.TIMEOUT_INTERVAL);
            return;
        }

        if (this.poppedOut.has(app.appId)) {
            this.log("Already popped out");
            this.poppedOut.get(app.appId).focus();
            return;
        }


        if (app && app.options && app.options.classes.includes("dialog")) {
            this.log("is dialog");
            if (app.actor && app.actor.apps) {
                const keys = Object.keys(app.actor.apps);
                this.log("has an apps keys", keys);
                if (keys.length == 1) {
                    const parent = app.actor.apps[keys[0]]
                    if (this.poppedOut.has(parent.appId)) {
                        this.log("Intercepting dialog of popped out window.");
                        this.moveDialog(app, parent);
                        return;
                    }
                }
            }
        }

        const domID = `popout_${this.ID}_${app.appId}`;
        if (!document.getElementById(domID)) { // Don't create a second link on re-renders;
            const link = $(`<a id="${domID}"><i class="fas fa-external-link-alt"></i>Popout</a>`)
            link.on("click", () => this.onPopoutClicked(app));
            const title = app.element.find(".window-title").after(link);
            this.log("Attached", app);
        }
    }

    moveDialog(app, parent) {
        const parentWindow = this.poppedOut.get(parent.appId);
        const dialogNode = app.element[0];

        // Hide element
        const setDisplay = dialogNode.style.display;
        dialogNode.style.display = "None";

        const newHeader = parentWindow.document.createElement("header")
        newHeader.setAttribute("class", "window-header flexrow");
        const headerElements = dialogNode.children[0].children;
        for (const element of Array.from(headerElements)) {
            newHeader.appendChild(parentWindow.document.adoptNode(element));
        }

        dialogNode.children[0].remove()

        const node = parentWindow.document.adoptNode(dialogNode);
        node.style.top = "50%";
        node.style.left = "50%";
        node.style.transform = "translate(-50%, -50%)"

        node.insertBefore(newHeader, node.children[0]);

        parent.element[0].parentNode.insertBefore(node, parent.element[0].nextSibling);
        node.style.display = setDisplay;
    }


    onPopoutClicked(app) {
        // Check if popout in Electron window
        if (navigator.userAgent.toLowerCase().indexOf(" electron/") !== -1) {
            ui.notifications.warn("Popout! cannot work within the standalone FVTT Application. Please open your game from a regular browser.");
            return;
        }

        // -------------------- Obtain application --------------------

        // Store original position for later use.
        const appPosition = { ...app.position };
        const appMinimized = app._minimized;


        // Hide the original node;
        const appNode = app._element[0];
        appNode.style.display = "none";

        // -------------------- Create Document --------------------

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

        // -------------------- Create window --------------------

        let windowFeatures = undefined;
        if (game.settings.get("popout", "useWindows")) {
            const padding = 30;
            const innerWidth = app._element.innerWidth() + padding * 2;
            const innerHeight = app._element.innerHeight() + padding * 2;
            const position = app._element.position;
            const left = window.screenX + position.left - padding;
            const top = window.screenY + position.top - padding;
            windowFeatures = `toolbar=0, location=0, menubar=0, titlebar=0, scrollbars=1, innerWidth=${innerWidth}, innerHeight=${innerHeight}, left=${left}, top=${top}`;
        }

        const dest = window.origin + "/__popout" // Deliberate 404
        const popout = window.open(dest, "_blank", windowFeatures);
        popout.location.hash = "popout";

        this.log("Window opened", dest, popout);

        if (!popout) {
            appNode.style.display = "revert"; // If we failed to open the window, show the app again.
            appNode._minimized = false;
            ui.notifications.warn(`Unable to open PopOut! window. Please check your site settings/permissions. Click the <i class="fas fa-info-circle"></i> to the left of the website URL.`);
            return;
        }

        // -------------------- Write document --------------------

        const doc = popout.document;
        doc.open();
        doc.write(doctype);
        doc.write(html.outerHTML);
        doc.close();
        doc.title = app.title;

        // -------------------- Add unload handlers --------------------

        window.addEventListener("unload", async (event) => {
            this.log("Unload event", event);
            const appId = app.appId;
            if (this.poppedOut.has(appId)) {
                await popout.close();
            }
            event.returnValue = true;
        });

        popout.addEventListener("unload", async (event) => {
            this.log("Unload event", event, popout.location.href);
            const appId = app.appId;
            if (this.poppedOut.has(appId)) {
                this.log("Closing popout", app.title);
                app.position = appPosition; // Set the original position.
                app._minimized = appMinimized;
                await app.close();
                await popout.close();
                this.poppedOut.delete(appId);
            }
            event.returnValue = true;
            // TODO(aposney: 2020-07-26): PopIn.
            // Need to save the original location and position and reset that before closing.
            // But probably not worth the effort.
        });

        // -------------------- Move element to window --------------------

        // We mimic the main games behavior by forcing new windows to open in a new tab.
        popout.addEventListener("click", (event) => {
            const a = event.target.closest("a[href]");
            if (!a || (a.href === "javascript:void(0)")) {
                return;
            }
            this.log("opening url", event, a);
            event.preventDefault();
            // NOTE(aposney: 2020-07-26):
            // This *MUST* be window and not popout. If it is popout.open it causes a crash
            // on Firefox.
            window.open(a.href, "_blank");
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
            app.setPosition({ width: "100%", height: "100%", top: 0, left: 0 });
            app._minimized = null;
            this.log("Final node", node, app);

        });

        // -------------------- Add app to out popout --------------------
        this.poppedOut.set(app.appId, popout);



        // -------------------- Install intercept methods ----------------

        const oldRender = app.render.bind(app);
        app.render = ((force, options) => {
            popout.focus();
            oldRender(force, options);
        });


        const oldMinimize = app.minimize.bind(app);
        app.minimize = (() => {
            this.log("Trying to focus main window."); // Doesn't appear to work due to popout blockers.
            window.focus();
            oldMinimize();
        });

        const oldMaximize = app.maximize.bind(app);
        app.maximize = (() => {
            popout.focus();
            this.log("Trying to focus popout.", app.appId);
            oldMaximize();
        });
    }
}


Hooks.on("ready", async () => {
    await (new PopoutModule()).init();
});