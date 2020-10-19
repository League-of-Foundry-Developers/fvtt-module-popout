"use strict";

class PopoutModule {
    constructor() {
        this.poppedOut = new Map();
        this.TIMEOUT_INTERVAL = 50; // ms
        this.MAX_TIMEOUT = 1000; // ms
        // Random id to prevent collision with other modules;
        this.ID = randomID(24);
    }

    log(msg, ...args) {
        if (game && game.settings.get("popout", "verboseLogs")) {
            const color = "background: #6699ff; color: #000; font-size: larger;";
            console.debug(`%c PopoutModule: ${msg}`, color, ...args);
        }
    }

    async init() {
        game.settings.register("popout", "useWindows", {
            name: game.i18n.localize("POPOUT.useWindows"),
            hint: game.i18n.localize("POPOUT.useWindowsHint"),
            scope: "client",
            config: true,
            default: true,
            type: Boolean,
        });

        game.settings.register("popout", "verboseLogs", {
            name: "Enable more module logging.",
            hint: "Enables more verbose module logging. This is useful for debugging the module. But otherwise should be left off.",
            scope: "client",
            config: false,
            default: false,
            type: Boolean,
        });

        // We replace the games window registry with a proxy object so we can intercept
        // every new application window creation event.
        const handler = {
            set: (obj, prop, value) => {
                const result = Reflect.set(obj, prop, value);
                this.log("Intercept ui-window create", value)
                if (value && value.options && value.options.popOut && !value.options.popOutModuleDisable) {
                     this.addPopout(value).catch(err => this.log(err));
                }
                return result;
            }
        };
        ui.windows = new Proxy(ui.windows, handler);
        this.log("Installed window interceptor", ui.windows);

        // NOTE(posnet: 2020-07-12): we need to initialize TinyMCE to ensure its plugins,
        // are loaded into the frame. Otherwise our popouts will not be able to access
        // the lazy loaded JavaScript mce plugins.
        // This will affect any module that lazy loads JavaScript. And require special handling.
        const elem = $(`<div style="display: none;"><p id="mce_init"> foo </p></div>`);
        $("body").append(elem);
        const config = { target: elem[0], plugins: CONFIG.TinyMCE.plugins };
        const editor = await tinyMCE.init(config);
        editor[0].remove();
    }

    async addPopout(app) {
        if (this.poppedOut.has(app.appId)) {
            this.log("Already popped out");
            this.poppedOut.get(app.appId).window.focus();
            return;
        }

        let waitRender = Math.floor(this.MAX_TIMEOUT / this.TIMEOUT_INTERVAL);
        while (app._state !== Application.RENDER_STATES.RENDERED &&
            waitRender-- > 0) {
            await new Promise((r) => setTimeout(r, this.TIMEOUT_INTERVAL));
        }
        if (app._state !== Application.RENDER_STATES.RENDERED) {
            this.log("Timeout out waiting for app to render");
            return;
        }

        if (this.handleChildDialog(app)) {
            return;
        }

        const domID = `popout_${this.ID}_${app.appId}`;
        if (!document.getElementById(domID)) {
            // Don't create a second link on re-renders;
            const link = $(
                `<a id="${domID}"><i class="fas fa-external-link-alt"></i>${game.i18n.localize("POPOUT.PopOut")}</a>`
            );
            link.on("click", () => this.onPopoutClicked(domID, app));
            const title = app.element.find(".window-title").after(link);
            this.log("Attached", app);
        }
    }

    handleChildDialog(app) {
        // This handler attempts to make behavior less confusing for modal/dialog like interactions
        // with a popped out window. A concrete example being a `pick spell level dialog` in response to
        // casting a spell.
        // The intended behavior is that new dialogs, (that have a child relationship to a parent popped out window),
        // get moved to the popped out window.
        // There are 3 heuristics we use to identify if something is a dialog.

        // The first is to check if the app has exactly one actor, then we assume that
        // actor is this apps parent.
        if (app && app.actor && app.actor.apps) {
            const keys = Object.keys(app.actor.apps);
            if (keys.length == 1) {
                const parent = app.actor.apps[keys[0]];
                if (this.poppedOut.has(parent.appId)) {
                    this.log("Intercepting dialog of popped out window.");
                    this.moveDialog(app, parent);
                    return true;
                }
            }
        }

        // The second is to check if the app has exactly 1 app in its object list.
        // and that app is *not* the surrounding app, in which case we assume
        // that the app in the object list is the true application.
        if (app && app.object && app.object.apps) {
            const keys = Object.keys(app.object.apps);
            if (keys.length == 1) {
                const parent = app.object.apps[keys[0]];
                if (this.poppedOut.has(parent.appId)) {
                    this.log("Intercepting dialog of popped out window.");
                    this.moveDialog(app, parent);
                    return true;
                }
            }
        }

        // The third is to fall back to the probability of whether this dialog belongs to a popout
        // by checking if there was a recent click in any of the existing popout windows
        const deadline = Date.now() - 1000; // Last click happened within the last second
        for (let state of this.poppedOut.values()) {
            if (state.window._popout_last_click > deadline) {
                this.log("Intercepting likely dialog of popped out window.");
                this.moveDialog(app, state.app);
                return true;
            }
        }

        return false;
    }

    moveDialog(app, parentApp) {
        const parent = this.poppedOut.get(parentApp.appId);
        const dialogNode = app.element[0];

        // Hide element
        const setDisplay = dialogNode.style.display;
        dialogNode.style.display = "None";

        const newHeader = parent.window.document.createElement("header");
        newHeader.setAttribute("class", "window-header flexrow");
        const headerElements = dialogNode.children[0].children;
        for (const element of [...headerElements]) {
            newHeader.appendChild(parent.window.document.adoptNode(element));
        }

        dialogNode.children[0].remove();

        const node = parent.window.document.adoptNode(dialogNode);
        node.style.top = "50%";
        node.style.left = "50%";
        node.style.transform = "translate(-50%, -50%)";

        node.insertBefore(newHeader, node.children[0]);

        parent.node.parentNode.insertBefore(node, parent.node.nextSibling);
        node.style.display = setDisplay;
        parent.children.push(app);
        Hooks.callAll("PopOut:dialog", app, parent);
    }

    createDocument() {
        // Create the new document.
        // Currently using raw js apis, since I need to ensure
        // jquery isn't doing something sneaky underneath.
        // In particular it makes some assumptions about there
        // being a single document.
        // We do this before opening the window because technically writing
        // to the new window is race condition with the page load.
        // But since we are directing to a placeholder file, it doesn't matter other than for UX purposes.
        const html = document.createElement("html");
        const head = document.importNode(document.getElementsByTagName("head")[0], true);
        const body = document.importNode(document.getElementsByTagName("body")[0], false);

        for (const child of [...head.children]) {
            if (child.nodeName === "SCRIPT" && child.src) {
                const src = child.src.replace(window.location.origin, "");
                if (!src.match(/tinymce|jquery|webfont|pdfjs/)) {
                    child.remove();
                }
            }
        }

        html.appendChild(head);
        html.appendChild(body);
        return html;
    }

    windowFeatures(app) {
        let windowFeatures = undefined;
        if (game.settings.get("popout", "useWindows")) {
            const padding = 30;
            const innerWidth = app.element.innerWidth() + padding * 2;
            const innerHeight = app.element.innerHeight() + padding * 2;
            const position = app.element.position(); // JQuery position function.
            const left = window.screenX + position.left - padding;
            const top = window.screenY + position.top - padding;
            windowFeatures = `toolbar=0, location=0, menubar=0, titlebar=0, scrollbars=1, innerWidth=${innerWidth}, innerHeight=${innerHeight}, left=${left}, top=${top}`;
        }
        return windowFeatures;
    }

    createWindow(features) {
        const popout = window.open("about:blank", "_blank", features);
        popout.location.hash = "popout";
        popout._rootWindow = window;
        this.log("Window opened", popout);
        return popout;
    }

    onPopoutClicked(domID, app) {
        // Check if popout in Electron window
        if (navigator.userAgent.toLowerCase().indexOf(" electron/") !== -1) {
            ui.notifications.warn(game.i18n.localize("POPOUT.electronWarning"));
            return;
        }

        const windowFeatures = this.windowFeatures(app);

        // -------------------- Obtain application --------------------
        const state = {
            app: app,
            node: app.element[0],
            position: duplicate(app.position),
            minimized: app._minimized,
            display: app.element[0].style.display,
            css: app.element[0].style.cssText,
            children: [],
        };

        // Hide the original node;
        state.node.style.display = "none";

        // --------------------------------------------------------

        const popout = this.createWindow(windowFeatures);

        if (!popout) {
            this.log("Failed to open window", popout);
            state.node.style.display = state.display;
            state.node._minimized = false;
            ui.notifications.warn(game.i18n.localize("POPOUT.failureWarning"));
            return;
        }

        // This is fiddly and probably not that robust to other modules.
        // But does provide behavior closer to the vanilla fvtt iterations.
        state.header = state.node.querySelector(".window-header");
        if (state.header) {
            state.header.remove();
        }

        state.handle = state.node.querySelector(".window-resizable-handle");
        if (state.handle) {
            state.handle.remove();
        }

        // We have to clone the header element and then remove the children
        // into it to ensure that the drag behavior is ignored.
        // however we have to manually move the actual controls over,
        // so that their event handlers are preserved.
        const shallowHeader = state.header.cloneNode(false);
        shallowHeader.classList.remove("draggable");
        for (const child of [...state.header.children]) {
            if (child.id == domID) {
                // Change Close button
                $(child).html(`<i class="fas fa-sign-in-alt"></i>${game.i18n.localize("POPOUT.PopIn")}`).off('click').on('click', ev => {
                    popout._popout_dont_close = true;
                    popout.close();
                })
            }
            shallowHeader.appendChild(child);
        }
        // re-parent the new shallow header to the app node.
        state.node.insertBefore(shallowHeader, state.node.children[0]);

        // -------------------- Write document --------------------

        const serializer = new XMLSerializer();
        const doctype = serializer.serializeToString(document.doctype);

        const srcDoc = this.createDocument();
        const targetDoc = popout.document;

        targetDoc.open();
        targetDoc.write(doctype);
        targetDoc.write(srcDoc.outerHTML);
        targetDoc.close();
        targetDoc.title = app.title;

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
            this.log("Unload event", event);
            const appId = app.appId;
            if (this.poppedOut.has(appId)) {
                const poppedOut = this.poppedOut.get(appId);
                this.log("Closing popout", app.title);
                app.position = poppedOut.position; // Set the original position.
                app._minimized = poppedOut.minimized;
                app.render = poppedOut.render;
                app.minimize = poppedOut.minimize;
                app.maximize = poppedOut.maximize;
                app.close = poppedOut.close;

                // Restore header bar to original state.
                const node = poppedOut.node;
                node.style.cssText = poppedOut.css;
                if (poppedOut.header) {
                    const header = node.querySelector(".window-header");
                    for (const child of [...header.children]) {
                        // Remove popin button so we can re-add it properly later
                        if (child.id !== domID) {
                            poppedOut.header.appendChild(child);
                        }
                    }

                    node.insertBefore(poppedOut.header, node.children[0]);
                    header.remove();
                }

                if (poppedOut.handle) {
                    node.appendChild(poppedOut.handle);
                }

                window.document.body.append(window.document.adoptNode(node));

                // We explicitly close any open dialog applications
                // because any other behavior would not make sense.
                // we can't pop them back in because moving them is
                // an irreversible operation at present.
                for (const child of poppedOut.children) {
                    if (child) {
                        child.close();
                    }
                }
                this.poppedOut.delete(appId);
                await popout.close();

                // Force a re-render or close it
                if (popout._popout_dont_close) {
                    Hooks.callAll("PopOut:popin", app);
                    app.render(true);
                    this.addPopout(app)
                } else {
                    app.close();
                }
            }
            event.returnValue = true;
        });

        // -------------------- Move element to window --------------------

        // We mimic the main games behavior by forcing new windows to open in a new tab.
        popout.addEventListener("click", (event) => {
            // Save the timestamp of the last click in this window
            popout._popout_last_click = Date.now();

            const a = event.target.closest("a[href]");
            if (!a || a.href === "javascript:void(0)") {
                return;
            }
            this.log("opening url", event, a);
            event.preventDefault();
            // NOTE(posnet: 2020-07-26):
            // Why would we want to use ownerDocument.defaultView?
            // This would mean that the new tab opened from a link will be opened
            // in the popped out window. Which would be the expected behavior instead
            // of the main window which is the current behavior.
            // However accessing the a.ownerDocument.defaultView crashes firefox.
            // Because of this, `const win` *MUST* be window and not the popped out window (i.e. ownerDocument.defaultView).
            // The following code block can be used once if firefox is fixed.
            //
            // const win = a.ownerDocument.defaultView;
            // if (win) {
            //     const opened = win.open(a.href, "_blank");
            // } else {
            //     const opened = window.open(a.href, "_blank");
            // }

            const opened = window.open(a.href, "_blank");
            if (!opened) {
                ui.notifications.warn(game.i18n.localize("POPOUT.failureWarning"));
            }
        });

        // We wait longer than just the DOMContentLoaded
        // because of how the document is constructed manually.
        popout.addEventListener("load", async (event) => {
            const body = event.target.getElementsByTagName("body")[0];
            const node = targetDoc.adoptNode(state.node);

            body.style.overflow = "auto";
            body.append(state.node);

            state.node.style.cssText = `
                display: flex;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                margin: 0 !important;
                border-radius: 0 !important;
                cursor: auto !important;
            `; // Fullscreen
            app.setPosition({ width: "100%", height: "100%", top: 0, left: 0 });
            app._minimized = null;

            // These event listeners don't get migrated because they are attached to a jQuery
            // selected body. This could be more of an issue in future as anyone doing a delegated
            // event handler will also fail. But that is bad practice.
            // The following regex will find examples of delegated event handlers in foundry.js
            // `on\(("|')[^'"]+("|'), *("|')`
            const jBody = $(body);
            jBody.on(
                "click",
                "a.entity-link",
                window.TextEditor._onClickEntityLink
            );
            jBody.on(
                "dragstart",
                "a.entity-link",
                window.TextEditor._onDragEntityLink
            );
            jBody.on(
                "click",
                "a.inline-roll",
                window.TextEditor._onClickInlineRoll
            );

            this.log("Final node", node, app);
        });

        // -------------------- Install intercept methods ----------------

        const oldRender = app.render.bind(app);
        app.render = (force, options) => {
            popout.focus();
            oldRender(force, options);
        };

        const oldClose = app.close.bind(app);
        app.close = function () {
            // Prevent closing of popped out windows with ESC in main page
            if (game.keyboard.isDown("Escape")) return;
            popout.close();
        };

        const oldMinimize = app.minimize.bind(app);
        app.minimize = () => {
            this.log("Trying to focus main window."); // Doesn't appear to work due to popout blockers.
            popout._rootWindow.focus();
            if (popout._rootWindow.getAttention) {
                popout._rootWindow.getAttention();
            }
            oldMinimize();
        };

        const oldMaximize = app.maximize.bind(app);
        app.maximize = () => {
            popout.focus();
            this.log("Trying to focus popout.", app.appId);
            oldMaximize();
        };

        state.window = popout;
        state.render = oldRender;
        state.minimize = oldMinimize;
        state.maximize = oldMaximize;
        state.close = oldClose;
        this.poppedOut.set(app.appId, state);
        Hooks.callAll("PopOut:popout", app, popout, state);
    }
}

Hooks.on("ready", () => {
    PopoutModule.singleton = new PopoutModule();
    PopoutModule.singleton.init();
});
