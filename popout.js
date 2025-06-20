"use strict";

class PopoutModule {
  constructor() {
    this.poppedOut = new Map();
    this.TIMEOUT_INTERVAL = 50; // ms
    this.MAX_TIMEOUT = 1000; // ms
    // Random id to prevent collision with other modules;
    // Use the new v12+ API if available, fallback to global for older versions
    this.ID = (foundry?.utils?.randomID || randomID)(24);
  }

  log(msg, ...args) {
    if (game && game.settings.get("popout", "verboseLogs")) {
      const color = "background: #6699ff; color: #000; font-size: larger;";
      console.debug(`%c PopoutModule: ${msg}`, color, ...args);
    }
  }

  recursiveBoundingBox(elem) {
    const maxRectReducer = (acc, elem) => {
      if (elem.width > 0 && elem.height > 0) {
        if (elem.x < acc.x) {
          acc.x = elem.x;
        }
        if (elem.y < acc.y) {
          acc.y = elem.y;
        }
        if (elem.x + elem.width > acc.x2) {
          acc.x2 = Math.ceil(elem.x + elem.width);
        }
        if (elem.y + elem.height > acc.y2) {
          acc.y2 = Math.ceil(elem.y + elem.height);
        }
      }
      return acc;
    };
    const initialValue = {
      x: Infinity,
      y: Infinity,
      x2: -Infinity,
      y2: -Infinity,
    };
    Array.from(elem.getElementsByTagName("*"))
      .map((item) => item.getBoundingClientRect())
      .reduce(maxRectReducer, initialValue);
    return {
      x: initialValue.x,
      y: initialValue.y,
      width: initialValue.x2 - initialValue.x,
      height: initialValue.y2 - initialValue.y,
    };
  }

  async init() {
    game.settings.register("popout", "showButton", {
      name: game.i18n.localize("POPOUT.showButton"),
      scope: "client",
      config: true,
      default: true,
      type: Boolean,
    });
    game.settings.register("popout", "iconOnly", {
      name: game.i18n.localize("POPOUT.iconOnly"),
      scope: "client",
      config: true,
      default: false,
      type: Boolean,
    });
    game.settings.register("popout", "useWindows", {
      name: game.i18n.localize("POPOUT.useWindows"),
      hint: game.i18n.localize("POPOUT.useWindowsHint"),
      scope: "client",
      config: true,
      default: true,
      type: Boolean,
    });
    game.settings.register("popout", "trueBoundingBox", {
      name: game.i18n.localize("POPOUT.boundingBox"),
      hint: game.i18n.localize("POPOUT.boundingBoxHint"),
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
      ownKeys: (target) => {
        return Reflect.ownKeys(target).filter((app) => {
          const appId = parseInt(app);
          if (!isNaN(appId)) {
            return !this.poppedOut.has(appId);
          }
          return true;
        });
      },
      set: (obj, prop, value) => {
        const result = Reflect.set(obj, prop, value);
        this.log("Intercept ui-window create", value);
        if (
          value &&
          value.options &&
          value.options.popOut &&
          !value.options.popOutModuleDisable
        ) {
          this.addPopout(value).catch((err) => this.log(err));
        }
        return result;
      },
    };
    ui.windows = new Proxy(ui.windows, handler);
    this.log("Installed window interceptor", ui.windows);

    // ApplicationV2 hooks will be registered after init in the ready hook below

    // COMPAT(posnet: 2022-09-24) v10 prosemirror
    // This is very stupid and bad, but people seem unaware that getElementById is not good.
    // In theory this might have performance issues, but I don't care at this point.
    // And it does fix the problem with prosemirror, and will help with any other modules making
    // the same mistake.

    if (game.release.generation >= 10) {
      const oldGetElementById = document.getElementById.bind(document);
      document.getElementById = function (id) {
        let elem = oldGetElementById(id);
        if (elem === null && this.poppedOut.size > 0) {
          for (const entry of this.poppedOut) {
            const doc = entry[1].window.document;
            elem = doc.getElementById(id);
            if (elem !== null) break;
          }
        }
        return elem;
      }.bind(this);
    }

    // NOTE(posnet: 2022-03-13): We need to overwrite the behavior of the hasFocus method of
    // the game keyboard class since it does not check all documents.

    // Define the override function that checks all windows including popouts
    const overrideHasFocus = () => {
      if (!game.keyboard || typeof game.keyboard.hasFocus !== "function")
        return false;

      // Store the original hasFocus method
      const originalHasFocus = game.keyboard.hasFocus.bind(game.keyboard);

      // Check if we're on v13 or later
      const isV13 =
        game.release?.generation >= 13 ||
        (foundry.utils?.isNewerVersion &&
          foundry.utils.isNewerVersion(game.version, "13.0.0"));

      // Override the hasFocus method to check popped out windows too
      game.keyboard.hasFocus = () => {
        // Helper function to check if an element has focus based on version
        const checkElementFocus = (element) => {
          if (!(element instanceof HTMLElement)) return false;

          if (isV13) {
            // v13 logic with dataset and specific checks
            if (["", "true"].includes(element.dataset.keyboardFocus))
              return true;
            if (element.dataset.keyboardFocus === "false") return false;
            if (["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName))
              return true;
            if (element.isContentEditable) return true;
            if (element.tagName === "BUTTON" && element.form) return true;
            return false;
          } else {
            // v12 logic - any focused HTMLElement counts
            return true;
          }
        };

        // Check main document
        if (checkElementFocus(document.activeElement)) return true;

        // Check all popped out windows
        for (const val of this.poppedOut.values()) {
          if (!val.window || val.window.closed) continue;
          if (checkElementFocus(val.window.document.activeElement)) return true;
        }

        return false;
      };

      return true;
    };

    // Try to override immediately, or defer until ready
    if (!overrideHasFocus()) {
      Hooks.once("ready", overrideHasFocus);
    }

    // NOTE(posnet: 2020-07-12): we need to initialize TinyMCE to ensure its plugins,
    // are loaded into the frame. Otherwise our popouts will not be able to access
    // the lazy loaded JavaScript mce plugins.
    // This will affect any module that lazy loads JavaScript. And require special handling.

    const elem = $(
      `<div style="display: none;"><p id="mce_init"> foo </p></div>`,
    );
    $("body").append(elem);
    const config = { target: elem[0], plugins: CONFIG.TinyMCE.plugins };
    const editor = await tinyMCE.init(config);
    editor[0].remove();
  }

  async addPopout(app) {
    if (
      app._disable_popout_module !== undefined &&
      app._disable_popout_module
    ) {
      this.log("Ignoring app marked as do not popout", app);
      return;
    }
    const appIdentifier = app.appId || app.id;
    if (this.poppedOut.has(appIdentifier)) {
      this.log("Already popped out");
      this.poppedOut.get(appIdentifier).window.focus();
      return;
    }

    let waitRender = Math.floor(this.MAX_TIMEOUT / this.TIMEOUT_INTERVAL);

    // Check render state for both v1 and v2 apps
    const isV1App = app._state !== undefined;
    const isV2App =
      app.state !== undefined && foundry?.applications?.ApplicationV2;

    while (waitRender-- > 0) {
      let isRendered = false;

      if (isV1App) {
        isRendered = app._state === Application.RENDER_STATES.RENDERED;
      } else if (isV2App) {
        isRendered =
          app.state ===
          foundry.applications.ApplicationV2.RENDER_STATES.RENDERED;
      } else {
        // For apps that don't have clear state, check if they have an element
        isRendered = !!(app.element || app._element);
      }

      if (isRendered) break;

      await new Promise((r) => setTimeout(r, this.TIMEOUT_INTERVAL));
    }

    // Check final render state
    let isRendered = false;
    if (isV1App) {
      isRendered = app._state === Application.RENDER_STATES.RENDERED;
    } else if (isV2App) {
      isRendered =
        app.state === foundry.applications.ApplicationV2.RENDER_STATES.RENDERED;
    } else {
      // For apps that don't have clear state, check if they have an element
      isRendered = !!(app.element || app._element);
    }

    if (!isRendered) {
      this.log("Timeout out waiting for app to render");
      return;
    }

    if (this.handleChildDialog(app)) {
      return;
    }

    let domID = this.appToID(app);
    if (!document.getElementById(domID)) {
      // Don't create a second link on re-renders;

      // class "header-button" is for compatibility with 🦋 Monarch
      let buttonText = game.i18n.localize("POPOUT.PopOut");
      if (game && game.settings.get("popout", "iconOnly")) {
        buttonText = "";
      }
      const link = $(
        `<a id="${domID}" class="popout-module-button"><i class="fas fa-external-link-alt" title="${game.i18n.localize(
          "POPOUT.PopOut",
        )}"></i>${buttonText}</a>`,
      );

      link.on("click", () => this.onPopoutClicked(app));

      // Handle both ApplicationV1 and ApplicationV2

      if (game && game.settings.get("popout", "showButton")) {
        let attached = false;

        if (app.element && app.element.find) {
          // ApplicationV1 - has jQuery element
          app.element.find(".window-title").after(link);
          attached = true;
        } else {
          // ApplicationV2 - try to find element by ID in DOM
          const appId = app.id || app.appId;
          let appElement = null;

          // Try different ways to find the element
          if (appId) {
            appElement = document.getElementById(appId);
          }
          if (!appElement && app._element) {
            appElement =
              app._element instanceof jQuery ? app._element[0] : app._element;
          }
          if (!appElement && app.element) {
            appElement =
              app.element instanceof jQuery ? app.element[0] : app.element;
          }

          if (appElement) {
            // For ApplicationV2, add to header controls area
            const header = appElement.querySelector(".window-header");
            const closeButton = header?.querySelector('[data-action="close"]');
            if (closeButton) {
              // Create header control button (always icon-only for ApplicationV2)
              const headerButton = document.createElement("button");
              headerButton.id = domID;
              headerButton.className =
                "header-control icon popout-module-button";
              headerButton.type = "button";
              headerButton.innerHTML =
                '<i class="fas fa-external-link-alt"></i>';
              headerButton.setAttribute(
                "data-tooltip",
                game.i18n.localize("POPOUT.PopOut"),
              );

              // Add click handler
              headerButton.addEventListener("click", () =>
                this.onPopoutClicked(app),
              );

              closeButton.parentNode.insertBefore(headerButton, closeButton);
              attached = true;
            }
          }
        }
      }
    }
  }

  appToID(app) {
    const appIdentifier = app.appId || app.id;
    const domID = `popout_${this.ID}_${appIdentifier}`;
    return domID;
  }

  getAppElement(app) {
    const isV2App = app.id && !app.appId; // V2 apps use 'id', V1 apps use 'appId'

    if (isV2App) {
      // ApplicationV2 - use ID to find the element
      const appId = app.id;
      if (appId) {
        const element = document.getElementById(appId);
        if (element) {
          return element;
        }
      }

      // Fallback for ApplicationV2
      if (app._element) {
        const element =
          app._element instanceof jQuery ? app._element[0] : app._element;
        return element;
      }
    } else {
      // ApplicationV1 - use jQuery element
      if (app.element && app.element[0]) {
        return app.element[0];
      }

      // Fallback for ApplicationV1 using appId
      const appId = app.appId;
      if (appId) {
        const element = document.getElementById(appId);
        if (element) {
          return element;
        }
      }
    }

    return null;
  }

  attachApplicationV2Events(app, clonedNode, popout) {
    this.log(
      "Skipping ApplicationV2 event re-attachment - events should survive adoptNode",
    );
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
        const parentId = parent.appId || parent.id;
        if (this.poppedOut.has(parentId)) {
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
        const parentId = parent.appId || parent.id;
        if (this.poppedOut.has(parentId)) {
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
        // Check for both v1 Dialog class and v2 dialog apps
        const isV1Dialog = app instanceof Dialog;
        const isV2Dialog =
          app.id &&
          !app.appId && // Must be ApplicationV2
          (app.constructor.name.includes("Dialog") ||
            app.constructor.name.includes("Config") ||
            app.constructor.name.includes("Roll")); // Common dialog patterns

        if (isV1Dialog || isV2Dialog) {
          this.log(
            "Intercepting likely dialog of popped out window:",
            app.constructor.name,
          );
          this.moveDialog(app, state.app);
          return true;
        }
      }
    }

    return false;
  }

  moveDialog(app, parentApp) {
    const parentId = parentApp.appId || parentApp.id;
    const parent = this.poppedOut.get(parentId);
    const dialogNode = this.getAppElement(app);

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
    const parentElement = this.getAppElement(parentApp);
    if (parentElement) {
      parentElement.style.zIndex = 0;
    }

    // We manually intercept the setPosition function of the dialog app in
    // order to handle re-renders that change the position.
    // In particular the FilePicker application.

    const oldClose = app.close.bind(app);
    const oldSetPosition = app.setPosition.bind(app);
    app.close = (...args) => {
      this.log("Intercepted dialog close, fixing setPosition.", app);
      app.setPosition = oldSetPosition;
      return oldClose.apply(app, args);
    };

    app.setPosition = () => {
      this.log("Intercepted dialog setting position", app.constructor.name);
    };

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
    // We copy any manually set styles on the root element to ensure that css variables are preserved.
    html.style.cssText = document.documentElement.style.cssText;
    const head = document.importNode(
      document.getElementsByTagName("head")[0],
      true,
    );
    const body = document.importNode(
      document.getElementsByTagName("body")[0],
      false,
    );

    for (const child of [...head.children]) {
      if (child.nodeName === "SCRIPT" && child.src) {
        const src = child.src.replace(window.location.origin, "");
        if (!src.match(/tinymce|jquery|webfont|pdfjs|prosemirror|common/)) {
          child.remove();
        }
      }
    }

    const cssFixContent = `
    .tox-tinymce-aux {
        position: unset !important;
    }
    `;
    const cssFix = document.createElement("style");
    cssFix.type = "text/css";
    cssFix.appendChild(document.createTextNode(cssFixContent));
    head.appendChild(cssFix);

    // BROKEN(posnet: 2024-08-19): Giving up on tooltips for the moment
    // I have a branch with a sort of viable solution, but it will be even more
    // brittle, and I am very hesitant to commit to supporting it.
    // // COMPAT(posnet: 2022-05-05):
    // // Last ditch effort to support tooltips. By far the worst hack I've needed to do.
    // // Basically I have just embedded a copy of the TooltipManager class from the base game directly
    // // into the popped out window because all other attempts to hack arround it have failed,
    // // either because it's extensive use of window and document methods, or the fact that it uses
    // // private js members. If this breaks again, I will most likely just leave it broken.
    // const tooltipNode = document.createElement("aside");
    // tooltipNode.id = "tooltip";
    // tooltipNode.role = "tooltip";
    // body.appendChild(tooltipNode);

    // const tooltipFix = document.createElement("script");
    // tooltipFix.appendChild(document.createTextNode(this.TOOLTIP_CODE));
    // head.append(tooltipFix);

    html.appendChild(head);
    html.appendChild(body);
    return html;
  }

  windowFeatures(app) {
    let windowFeatures = undefined;
    let offsets = {
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
    };

    if (game.settings.get("popout", "useWindows")) {
      let position, width, height, left, top, element;

      // Handle both ApplicationV1 (jQuery) and ApplicationV2 (native DOM)
      if (app.element && app.element.position) {
        // ApplicationV1 with jQuery element
        position = app.element.position();
        width = app.element.innerWidth();
        height = app.element.innerHeight();
        left = position.left;
        top = position.top;
        element = app.element[0];
      } else {
        // ApplicationV2 with native DOM element
        const nativeElement = this.getAppElement(app);
        if (nativeElement) {
          const rect = nativeElement.getBoundingClientRect();
          left = rect.left + window.scrollX;
          top = rect.top + window.scrollY;
          width = rect.width;
          height = rect.height;
          element = nativeElement;
        } else {
          // Fallback values if no element found
          left = 100;
          top = 100;
          width = 800;
          height = 600;
          element = null;
        }
      }

      if (element && game && game.settings.get("popout", "trueBoundingBox")) {
        const bounding = this.recursiveBoundingBox(element);
        if (bounding.x < left) {
          offsets.left = `${left - bounding.x}`;
          left = bounding.x;
        }
        if (bounding.y < top) {
          offsets.top = `${top - bounding.y}`;
          top = bounding.y;
        }
        if (bounding.width > width) {
          offsets.width = `calc(100% - ${bounding.width - width}px)`;
          width = bounding.width;
        }
        // BREAKFIX(posnet: 2024-02-18)
        // If an element has overflow: hidden set, this breaks the
        // bounding box algo since it can end up with a bounding height
        // larget than the window. I thought that changing the Infinity
        // values in the recursiveBoundingBox function would fix this,
        // however it it also fails in different ways. For the moment
        // I'm going to make a break/fix release to remove the height
        // calc because as far as a know the only side elements in pathfinder
        // or foundry are the ones overflowing. So we'll just set height
        // to the the default value for now.
        // if (bounding.height > height) {
        //   offsets.height = `calc(100% - ${bounding.height - height}px)`;
        //   height = bounding.height;
        // }
        // BREAKFIX
      }

      const padding = 30;
      const innerWidth = width + padding * 2;
      const innerHeight = height + padding * 2;
      const wleft = window.screenX + left - padding;
      const wtop = window.screenY + top - padding;
      windowFeatures = `toolbar=0, location=0, menubar=0, titlebar=0, scrollbars=1, innerWidth=${innerWidth}, innerHeight=${innerHeight}, left=${wleft}, top=${wtop}`;
    }
    return {
      windowFeatures: windowFeatures,
      offsets: offsets,
    };
  }

  createWindow(features) {
    const popout = window.open("about:blank", "_blank", features);
    if (!popout) {
      return null;
    }
    popout.location.hash = "popout";
    popout._rootWindow = window;
    this.log("Window opened", popout);
    return popout;
  }

  onPopoutClicked(app) {
    // Check if popout in Electron window
    if (navigator.userAgent.toLowerCase().indexOf(" electron/") !== -1) {
      ui.notifications.warn(game.i18n.localize("POPOUT.electronWarning"));
      return;
    }

    // Check both v1 and v2 applications
    const appIdentifier = app.appId || app.id;
    const isV1App = window.ui.windows[app.appId] !== undefined;
    const isV2App = foundry?.applications?.instances?.has(app.id);

    if (!isV1App && !isV2App) {
      this.log("Attempt to open not a user interface window.");
      return;
    }

    if (this.poppedOut.has(appIdentifier)) {
      // This check is to ensure PopOut is idempotent to popout calls.
      let currentState = this.poppedOut.get(appIdentifier);
      if (currentState && currentState.window && !currentState.window.closed) {
        currentState.window.focus();
        return;
      } else if (
        currentState &&
        currentState.window &&
        currentState.window.closed
      ) {
        this.poppedOut.delete(appIdentifier);
      }
    }

    const { windowFeatures, offsets } = this.windowFeatures(app);
    this.log("Features", windowFeatures, offsets);

    // -------------------- Obtain application --------------------
    const appElement = this.getAppElement(app);
    if (!appElement) {
      this.log("Could not find element for app");
      return;
    }

    const state = {
      app: app,
      node: appElement,
      position: foundry?.utils?.duplicate
        ? foundry.utils.duplicate(app.position)
        : duplicate(app.position),
      minimized: app._minimized,
      display: appElement.style.display,
      css: appElement.style.cssText,
      children: [],
    };

    this.log("Application state", state);

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
    // Try multiple selectors for different application types
    state.header =
      state.node.querySelector(".window-header") ||
      state.node.querySelector("header.window-header") ||
      state.node.querySelector(".application-header");

    // For ApplicationV2, also store the controls dropdown if it exists
    state.controlsDropdown = state.node.querySelector(".controls-dropdown");

    if (state.header) {
      state.header.remove();
    }
    if (state.controlsDropdown) {
      state.controlsDropdown.remove();
    }

    state.handle = state.node.querySelector(".window-resizable-handle");
    if (state.handle) {
      state.handle.remove();
    }

    // We have to clone the header element and then remove the children
    // into it to ensure that the drag behavior is ignored.
    // however we have to manually move the actual controls over,
    // so that their event handlers are preserved.
    if (state.header) {
      const shallowHeader = state.header.cloneNode(false);
      shallowHeader.classList.remove("draggable");
      let domID = this.appToID(app);
      for (const child of [...state.header.children]) {
        if (child.id == domID) {
          // Change Close button

          let buttonText = game.i18n.localize("POPOUT.PopIn");
          // ApplicationV2 apps always use icon-only buttons
          const isV2App = app.id && !app.appId; // V2 apps use 'id', V1 apps use 'appId'
          if ((game && game.settings.get("popout", "iconOnly")) || isV2App) {
            buttonText = "";
          }

          $(child)
            .html(
              `<i class="fas fa-sign-in-alt" title="${game.i18n.localize(
                "POPOUT.PopIn",
              )}"></i>${buttonText}`,
            )
            .off("click")
            .on("click", (event) => {
              popout._popout_dont_close = true;
              popout.close();
            });
        }
        shallowHeader.appendChild(child);
      }
      // re-parent the new shallow header to the app node.
      state.node.insertBefore(shallowHeader, state.node.children[0]);
    } else {
      this.log("No header found for application, skipping header manipulation");
    }

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

    Hooks.callAll("PopOut:loading", app, popout);

    window.addEventListener("unload", async (event) => {
      this.log("Unload event", event);
      const appId = app.appId || app.id;
      if (this.poppedOut.has(appId)) {
        await popout.close();
      }
      event.returnValue = true;
    });

    popout.addEventListener("unload", async (event) => {
      this.log("Unload event", event);
      const appId = app.appId || app.id;
      if (this.poppedOut.has(appId)) {
        const poppedOut = this.poppedOut.get(appId);
        this.log("Closing popout", app.title);
        app.position = poppedOut.position; // Set the original position.
        app._minimized = poppedOut.minimized;
        app.bringToTop = poppedOut.bringToTop;
        app.render = poppedOut.render;
        app.minimize = poppedOut.minimize;
        app.maximize = poppedOut.maximize;
        app.close = poppedOut.close;

        // Restore header bar to original state.
        const node = poppedOut.node;
        node.style.cssText = poppedOut.css;
        if (poppedOut.header) {
          const header =
            node.querySelector(".window-header") ||
            node.querySelector("header.window-header") ||
            node.querySelector(".application-header");
          if (header) {
            for (const child of [...header.children]) {
              // Remove popin button so we can re-add it properly later
              const popinButtonId = this.appToID(app);
              if (child.id !== popinButtonId) {
                poppedOut.header.appendChild(child);
              }
            }
          }

          node.insertBefore(poppedOut.header, node.children[0]);
          if (header) {
            header.remove();
          }
        }

        if (poppedOut.handle) {
          node.appendChild(poppedOut.handle);
        }

        // Restore controls dropdown for ApplicationV2
        if (poppedOut.controlsDropdown) {
          // Insert after header
          if (poppedOut.header) {
            poppedOut.header.insertAdjacentElement(
              "afterend",
              poppedOut.controlsDropdown,
            );
          } else {
            // Fallback: add at the beginning of the node
            node.insertBefore(poppedOut.controlsDropdown, node.children[0]);
          }
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

        // Force a re-render or close it
        if (popout._popout_dont_close) {
          Hooks.callAll("PopOut:popin", app);
          await app.render(true);
          this.addPopout(app);
        } else {
          Hooks.callAll("PopOut:close", app, node);
          await app.close();
        }
        await popout.close();
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
      if (popout.screenX < 0 || popout.screenY < 0) {
        // Fallback in case for some reason the popout out window is not
        // on the visible screen. May not work or be blocked by popout blockers,
        // but it is the best we can do.
        popout.moveTo(50, 50);
      }

      if (game.release.generation >= 10) {
        const FontConfigClass =
          foundry?.applications?.settings?.menus?.FontConfig || FontConfig;
        const allFonts = FontConfigClass._collectDefinitions();
        const families = new Set();
        for (const definitions of allFonts) {
          for (const [family] of Object.entries(definitions)) {
            families.add(family);
          }
        }
        document.fonts.forEach((font) => {
          if (families.has(font.family)) {
            try {
              popout.document.fonts.add(font);
            } catch {}
          }
        });
      }

      const body = event.target.getElementsByTagName("body")[0];

      // Handle ApplicationV2 which uses different DOM adoption
      const isApplicationV2 = app.id && !app.appId; // V2 apps use 'id', V1 apps use 'appId'

      if (isApplicationV2) {
        // FIXME(aposney: 2025-06-16) Not convinced this is an issue, it does cause errors in logs, but leaving
        // // Monkey-patch D&D5e custom elements to handle adoptedStyleSheets gracefully
        const customElements = state.node.querySelectorAll(
          "slide-toggle, dnd5e-checkbox, proficiency-cycle, dnd5e-icon",
        );
        customElements.forEach((element) => {
          if (element._adoptStyleSheet) {
            const original_adoptStyleSheet = element._adoptStyleSheet;
            element._adoptStyleSheet = function (sheet) {
              try {
                return original_adoptStyleSheet.call(this, sheet);
              } catch (error) {
                PopoutModule.singleton.log(
                  "Caught adoptedStyleSheets error for",
                  this.tagName,
                  "- continuing without styles",
                );
                // Fail silently to prevent breaking the popout
              }
            };
          }
        });

        try {
          const adoptedNode = targetDoc.adoptNode(state.node);
          body.style.overflow = "auto";
          body.append(adoptedNode);
          // Update state to reference the adopted node
          state.node = adoptedNode;
        } catch (error) {
          this.log("Error adopting ApplicationV2 node:", error);
          throw error;
        }
      } else {
        // ApplicationV1 - use the original adoption method
        const adoptedNode = targetDoc.adoptNode(state.node);
        body.style.overflow = "auto";
        body.append(state.node);
      }

      state.node.style.cssText = `
                display: flex;
                top: ${offsets.top};
                left: ${offsets.left};
                width: ${offsets.width};
                height: ${offsets.height};
                margin: 0 !important;
                border-radius: 0 !important;
                cursor: auto !important;
            `; // Fullscreen
      app.setPosition({ width: "100%", height: "100%", top: 0, left: 0 });
      app._minimized = null;

      // Disable touch zoom
      popout.document.addEventListener("touchmove", (ev) => {
        if (ev.scale !== 1) ev.preventDefault();
      });
      // Disable right-click
      popout.document.addEventListener("contextmenu", (ev) =>
        ev.preventDefault(),
      );
      // Disable mouse 3, 4, and 5
      popout.document.addEventListener("pointerdown", (ev) => {
        if ([3, 4, 5].includes(ev.button)) ev.preventDefault();
      });

      // Forward keyboard events to main window for keybinding support
      // NOTE: v13 changed the keyboard API, _handleKeyboardEvent is private/removed
      popout.addEventListener("keydown", (event) => {
        if (window.keyboard && window.keyboard._handleKeyboardEvent) {
          // v12 and earlier - use private method
          window.keyboard._handleKeyboardEvent(event, false);
        } else if (game.keyboard && game.keyboard.onKeyDown) {
          // v13+ - try public API
          game.keyboard.onKeyDown(event);
        }
        // For v13, if no API available, let the event bubble normally
      });
      popout.addEventListener("keyup", (event) => {
        if (window.keyboard && window.keyboard._handleKeyboardEvent) {
          // v12 and earlier - use private method
          window.keyboard._handleKeyboardEvent(event, true);
        } else if (game.keyboard && game.keyboard.onKeyUp) {
          // v13+ - try public API
          game.keyboard.onKeyUp(event);
        }
        // For v13, if no API available, let the event bubble normally
      });

      // COMPAT(posnet: 2022-09-17) v9

      if (game.release.generation < 10) {
        // From: TextEditor.activateListeners();
        // These event listeners don't get migrated because they are attached to a jQuery
        // selected body. This could be more of an issue in future as anyone doing a delegated
        // event handler will also fail. But that is bad practice.
        // The following regex will find examples of delegated event handlers in foundry.js
        // `on\(("|')[^'"]+("|'), *("|')`
        const jBody = $(body);
        jBody.on(
          "click",
          "a.entity-link",
          window.TextEditor._onClickEntityLink !== undefined
            ? window.TextEditor._onClickEntityLink
            : window.TextEditor._onClickContentLink,
        );
        jBody.on(
          "dragstart",
          "a.entity-link",
          window.TextEditor._onDragEntityLink,
        );
        jBody.on(
          "click",
          "a.inline-roll",
          window.TextEditor._onClickInlineRoll,
        );
      } else {
        // From: TextEditor.activateListeners();
        // These event listeners don't get migrated because they are attached to a jQuery
        // selected body. This could be more of an issue in future as anyone doing a delegated
        // event handler will also fail. But that is bad practice.
        // The following regex will find examples of delegated event handlers in foundry.js
        // `on\(("|')[^'"]+("|'), *("|')`
        // Only attach jQuery delegated events for ApplicationV1
        if (!isApplicationV2) {
          const jBody = $(body);
          if (game.release.generation < 13) {
            jBody.on(
              "click",
              "a.content-link",
              window.TextEditor._onClickEntityLink !== undefined
                ? window.TextEditor._onClickEntityLink
                : window.TextEditor._onClickContentLink,
            );
            jBody.on(
              "dragstart",
              "a.content-link",
              window.TextEditor._onDragEntityLink !== undefined
                ? window.TextEditor._onDragEntityLink
                : window.TextEditor._onDragContentLink,
            );
          }
          jBody.on(
            "click",
            "a.inline-roll",
            window.TextEditor._onClickInlineRoll,
          );
        }
      }

      popout.game = game;

      // Only try to setup tooltip manager if it exists
      if (popout.tooltip_manager && popout.document.getElementById("tooltip")) {
        popout.tooltip_manager.tooltip =
          popout.document.getElementById("tooltip");
        popout.tooltip_manager.activateEventListeners();
      }

      Hooks.callAll("PopOut:loaded", app, state.node);
    });

    // -------------------- Install intercept methods ----------------

    const oldBringToTop = app.bringToTop.bind(app);
    app.bringToTop = (...args) => {
      this.log("Intercepted popout bringToTop", app);
      popout.focus();
      const result = oldBringToTop.apply(app, args);
      // In a popout we always want the base sheet to be at the back.
      const appElement = this.getAppElement(app);
      if (appElement) {
        appElement.style.zIndex = 0;
      }
      return result;
    };

    const oldRender = app.render.bind(app);
    app.render = (...args) => {
      this.log("Intercepted popout render", app);
      return oldRender.apply(app, args);
    };

    const oldClose = app.close.bind(app);
    app.close = (...args) => {
      this.log("Intercepted popout close.", app);
      // Prevent closing of popped out windows with ESC in main page

      if (game.keyboard.isDown !== undefined) {
        // COMPAT(posnet: 2022-09-17) v9 compat
        if (game.keyboard.isDown("Escape")) return;
      } else {
        if (game.keyboard.downKeys.has("Escape")) return;
      }
      popout.close();
      return oldClose.apply(app, args);
    };

    const oldMinimize = app.minimize.bind(app);
    app.minimize = (...args) => {
      this.log(
        "Intercepted minimize on popped out app - ignoring:",
        app.constructor.name,
      );
      // Don't minimize popped out applications (e.g., during template placement)
      // Just return without calling the original minimize
      return;
    };

    const oldMaximize = app.maximize.bind(app);
    app.maximize = (...args) => {
      this.log(
        "Intercepted maximize on popped out app - focusing popout instead:",
        app.constructor.name,
      );
      // Don't maximize popped out applications, just focus the popout window
      popout.focus();
      return;
    };

    const oldSetPosition = app.setPosition.bind(app);
    app.setPosition = (...args) => {
      const appId = app.appId || app.id;
      if (this.poppedOut.has(appId)) {
        this.log(
          "Intercepted application setting position",
          app.constructor.name,
        );
        return {};
      }
      return oldSetPosition.apply(app, args);
    };

    state.window = popout;
    state.bringToTop = oldBringToTop;
    state.render = oldRender;
    state.minimize = oldMinimize;
    state.maximize = oldMaximize;
    state.close = oldClose;
    const finalAppId = app.appId || app.id;
    this.poppedOut.set(finalAppId, state);
    Hooks.callAll("PopOut:popout", app, popout);
  }

  // Public API
  static popoutApp(app) {
    if (PopoutModule.singleton) {
      PopoutModule.singleton.onPopoutClicked(app);
    }
  }
}

Hooks.on("ready", () => {
  PopoutModule.singleton = new PopoutModule();
  PopoutModule.singleton.init();

  // Add ApplicationV2 support for v13 using instance interception
  if (foundry?.applications?.instances) {
    const instances = foundry.applications.instances;
    const originalSet = instances.set.bind(instances);
    const originalDelete = instances.delete.bind(instances);

    instances.set = function (id, app) {
      // Call the original set method
      const result = originalSet(id, app);

      // Check if this is a popout-able application

      // Only process apps that have popOut capability
      // Note: popOut defaults to true if undefined in ApplicationV2
      if (
        app &&
        app.options &&
        app.options.popOut !== false && // Allow undefined (defaults to true)
        !app.options.popOutModuleDisable
      ) {
        // Defer to ensure the app is rendered
        setTimeout(() => {
          PopoutModule.singleton
            .addPopout(app)
            .catch((err) =>
              PopoutModule.singleton.log(
                "Error adding popout to ApplicationV2:",
                err,
              ),
            );
        }, 100);
      }

      return result;
    };

    instances.delete = function (id) {
      // Clean up our poppedOut map if the app is deleted
      if (PopoutModule.singleton.poppedOut.has(id)) {
        const state = PopoutModule.singleton.poppedOut.get(id);
        if (state && state.window && !state.window.closed) {
          state.window.close();
        }
        PopoutModule.singleton.poppedOut.delete(id);
      }

      // Call the original delete method
      return originalDelete(id);
    };
    PopoutModule.singleton.log("ApplicationV2 interception initialized");
  }

  Hooks.on("PopOut:loaded", async (app, node) => {
    // PDFoundry
    if (window.ui.PDFoundry !== undefined) {
      app._viewer = false;
      if (app.pdfData && app.pdfData.url !== undefined) {
        app.open(
          new URL(app.pdfData.url, window.location).href,
          app.pdfData.offset,
        );
      }
      if (app.onViewerReady !== undefined) {
        app.onViewerReady();
      }
    }
    return;
  });

  Hooks.on("PopOut:close", async (app, node) => {
    // PDFoundry
    if (app.pdfData !== undefined) {
      if (app.actorSheet && app.actorSheet.close) {
        await app.actorSheet.close();
      }
    }
    return;
  });
});
