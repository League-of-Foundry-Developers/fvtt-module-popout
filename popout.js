"use strict";

class PopoutModule {
  constructor() {
    this.poppedOut = new Map();
    this.TIMEOUT_INTERVAL = 50; // ms
    this.MAX_TIMEOUT = 1000; // ms
    // Random id to prevent collision with other modules;
    this.ID = randomID(24); // eslint-disable-line no-undef

    this.TOOLTIP_CODE = `
class TooltipManager {

  /**
    * A cached reference to the global tooltip element
    * @type {HTMLElement}
    */
  tooltip = document.getElementById("tooltip");

  /**
    * A reference to the HTML element which is currently tool-tipped, if any.
    * @type {HTMLElement|null}
    */
  element = null;

  /**
    * An amount of margin which is used to offset tooltips from their anchored element.
    * @type {number}
    */
  static TOOLTIP_MARGIN_PX = 5;

  /**
    * The number of milliseconds delay which activates a tooltip on a "long hover".
    * @type {number}
    */
  static TOOLTIP_ACTIVATION_MS = 500;

  /**
    * The directions in which a tooltip can extend, relative to its tool-tipped element.
    * @enum {string}
    */
  static TOOLTIP_DIRECTIONS = {
    UP: "UP",
    DOWN: "DOWN",
    LEFT: "LEFT",
    RIGHT: "RIGHT",
    CENTER: "CENTER"
  };

  /**
    * The number of pixels buffer around a locked tooltip zone before they should be dismissed.
    * @type {number}
    */
  static LOCKED_TOOLTIP_BUFFER_PX = 50;

  /**
    * Is the tooltip currently active?
    * @type {boolean}
    */
  #active = false;

  /**
    * A reference to a window timeout function when an element is activated.
    */
  #activationTimeout;

  /**
    * A reference to a window timeout function when an element is deactivated.
    */
  #deactivationTimeout;

  /**
    * An element which is pending tooltip activation if hover is sustained
    * @type {HTMLElement|null}
    */
  #pending;

  /**
    * Maintain state about active locked tooltips in order to perform appropriate automatic dismissal.
    * @type {{elements: Set<HTMLElement>, boundingBox: Rectangle}}
    */
  #locked = {
    elements: new Set(),
    boundingBox: {}
  };

  /* -------------------------------------------- */

  /**
    * Activate interactivity by listening for hover events on HTML elements which have a data-tooltip defined.
    */
  activateEventListeners() {
    console.log(document.body.NAME);
    document.body.addEventListener("pointerenter", this.#onActivate.bind(this), true);
    document.body.addEventListener("pointerleave", this.#onDeactivate.bind(this), true);
    document.body.addEventListener("pointerup", this._onLockTooltip.bind(this), true);
    document.body.addEventListener("pointermove", this.#testLockedTooltipProximity.bind(this), {
      capture: true,
      passive: true
    });
  }

  /* -------------------------------------------- */

  /**
    * Handle hover events which activate a tooltipped element.
    * @param {PointerEvent} event    The initiating pointerenter event
    */
  #onActivate(event) {
    // if ( Tour.tourInProgress ) return; // Don't activate tooltips during a tour
    const element = event.target;
    if ( element.closest(".editor-content.ProseMirror") ) return; // Don't activate tooltips inside text editors.
    if ( !element.dataset.tooltip ) {
      // Check if the element has moved out from underneath the cursor and pointerenter has fired on a non-child of the
      // tooltipped element.
      if ( this.#active && !this.element.contains(element) ) this.#startDeactivation();
      return;
    }

    // Don't activate tooltips if the element contains an active context menu or is in a matching link tooltip
    if ( element.matches("#context-menu") || element.querySelector("#context-menu") ) return;

    // If the tooltip is currently active, we can move it to a new element immediately
    if ( this.#active ) {
      this.activate(element);
      return;
    }

    // Clear any existing deactivation workflow
    this.#clearDeactivation();

    // Delay activation to determine user intent
    this.#pending = element;
    this.#activationTimeout = window.setTimeout(() => {
      this.#activationTimeout = null;
      if ( this.#pending ) this.activate(this.#pending);
    }, this.constructor.TOOLTIP_ACTIVATION_MS);
  }

  /* -------------------------------------------- */

  /**
    * Handle hover events which deactivate a tooltipped element.
    * @param {PointerEvent} event    The initiating pointerleave event
    */
  #onDeactivate(event) {
    if ( event.target !== (this.element ?? this.#pending) ) return;
    const parent = event.target.parentElement.closest("[data-tooltip]");
    if ( parent ) this.activate(parent);
    else this.#startDeactivation();
  }

  /* -------------------------------------------- */

  /**
    * Start the deactivation process.
    */
  #startDeactivation() {
    if ( this.#deactivationTimeout ) return;

    // Clear any existing activation workflow
    this.clearPending();

    // Delay deactivation to confirm whether some new element is now pending
    this.#deactivationTimeout = window.setTimeout(() => {
      this.#deactivationTimeout = null;
      if ( !this.#pending ) this.deactivate();
    }, this.constructor.TOOLTIP_ACTIVATION_MS);
  }

  /* -------------------------------------------- */

  /**
    * Clear any existing deactivation workflow.
    */
  #clearDeactivation() {
    window.clearTimeout(this.#deactivationTimeout);
    this.#deactivationTimeout = null;
  }

  /* -------------------------------------------- */

  /**
    * Activate the tooltip for a hovered HTML element which defines a tooltip localization key.
    * @param {HTMLElement} element         The HTML element being hovered.
    * @param {object} [options={}]         Additional options which can override tooltip behavior.
    * @param {string} [options.text]       Explicit tooltip text to display. If this is not provided the tooltip text is
    *                                      acquired from the elements data-tooltip attribute. This text will be
    *                                      automatically localized
    * @param {TooltipManager.TOOLTIP_DIRECTIONS} [options.direction]  An explicit tooltip expansion direction. If this
    *                                      is not provided the direction is acquired from the data-tooltip-direction
    *                                      attribute of the element or one of its parents.
    * @param {string} [options.cssClass]   An optional, space-separated list of CSS classes to apply to the activated
    *                                      tooltip. If this is not provided, the CSS classes are acquired from the
    *                                      data-tooltip-class attribute of the element or one of its parents.
    * @param {boolean} [options.locked]    An optional boolean to lock the tooltip after creation. Defaults to false.
    * @param {HTMLElement} [options.content]  Explicit HTML content to inject into the tooltip rather than using tooltip
    *                                         text.
    */
  activate(element, {text, direction, cssClass, locked=false, content}={}) {
    if ( text && content ) throw new Error("Cannot provide both text and content options to TooltipManager#activate.");
    // Deactivate currently active element
    this.deactivate();
    // Check if the element still exists in the DOM.
    if ( !document.body.contains(element) ) return;
    // Mark the new element as active
    this.#active = true;
    this.element = element;
    element.setAttribute("aria-describedby", "tooltip");
    if ( content ) {
      this.tooltip.innerHTML = ""; // Clear existing content.
      this.tooltip.appendChild(content);
    }
    else this.tooltip.innerHTML = text || game.i18n.localize(element.dataset.tooltip);

    // Activate display of the tooltip
    this.tooltip.removeAttribute("class");
    this.tooltip.classList.add("active");
    cssClass ??= element.closest("[data-tooltip-class]")?.dataset.tooltipClass;
    if ( cssClass ) this.tooltip.classList.add(...cssClass.split(" "));

    // Set tooltip position
    direction ??= element.closest("[data-tooltip-direction]")?.dataset.tooltipDirection;
    if ( !direction ) direction = this._determineDirection();
    this._setAnchor(direction);

    if ( locked || element.dataset.hasOwnProperty("locked") ) this.lockTooltip();
  }

  /* -------------------------------------------- */

  /**
    * Deactivate the tooltip from a previously hovered HTML element.
    */
  deactivate() {
    // Deactivate display of the tooltip
    this.#active = false;
    this.tooltip.classList.remove("active");

    // Clear any existing (de)activation workflow
    this.clearPending();
    this.#clearDeactivation();

    // Update the tooltipped element
    if ( !this.element ) return;
    this.element.removeAttribute("aria-describedby");
    this.element = null;
  }

  /* -------------------------------------------- */

  /**
    * Clear any pending activation workflow.
    * @internal
    */
  clearPending() {
    window.clearTimeout(this.#activationTimeout);
    this.#pending = this.#activationTimeout = null;
  }

  /* -------------------------------------------- */

  /**
    * Lock the current tooltip.
    * @returns {HTMLElement}
    */
  lockTooltip() {
    const clone = this.tooltip.cloneNode(false);
    // Steal the content from the original tooltip rather than cloning it, so that listeners are preserved.
    while ( this.tooltip.firstChild ) clone.appendChild(this.tooltip.firstChild);
    clone.removeAttribute("id");
    clone.classList.add("locked-tooltip", "active");
    document.body.appendChild(clone);
    this.deactivate();
    clone.addEventListener("contextmenu", this._onLockedTooltipDismiss.bind(this));
    this.#locked.elements.add(clone);

    // If the tooltip's contents were injected via setting innerHTML, then immediately requesting the bounding box will
    // return incorrect values as the browser has not had a chance to reflow yet. For that reason we defer computing the
    // bounding box until the next frame.
    requestAnimationFrame(() => this.#computeLockedBoundingBox());
    return clone;
  }

  /* -------------------------------------------- */

  /**
    * Handle a request to lock the current tooltip.
    * @param {MouseEvent} event  The click event.
    * @protected
    */
  _onLockTooltip(event) {
    if ( (event.button !== 1) || !this.#active) return; // || Tour.tourInProgress ) return;
    event.preventDefault();
    this.lockTooltip();
  }

  /* -------------------------------------------- */

  /**
    * Handle dismissing a locked tooltip.
    * @param {MouseEvent} event  The click event.
    * @protected
    */
  _onLockedTooltipDismiss(event) {
    event.preventDefault();
    const target = event.currentTarget;
    this.dismissLockedTooltip(target);
  }

  /* -------------------------------------------- */

  /**
    * Dismiss a given locked tooltip.
    * @param {HTMLElement} element  The locked tooltip to dismiss.
    */
  dismissLockedTooltip(element) {
    this.#locked.elements.delete(element);
    element.remove();
    this.#computeLockedBoundingBox();
  }

  /* -------------------------------------------- */

  /**
    * Compute the unified bounding box from the set of locked tooltip elements.
    */
  #computeLockedBoundingBox() {
    let bb = null;
    for ( const element of this.#locked.elements.values() ) {
      const {x, y, width, height} = element.getBoundingClientRect();
      const rect = new PIXI.Rectangle(x, y, width, height);
      if ( bb ) bb.enlarge(rect);
      else bb = rect;
    }
    this.#locked.boundingBox = bb;
  }

  /* -------------------------------------------- */

  /**
    * Check whether the user is moving away from the locked tooltips and dismiss them if so.
    * @param {MouseEvent} event  The mouse move event.
    */
  #testLockedTooltipProximity(event) {
    if ( !this.#locked.elements.size ) return;
    const {clientX: x, clientY: y} = event;
    const buffer = this.#locked.boundingBox?.clone?.().pad(this.constructor.LOCKED_TOOLTIP_BUFFER_PX);
    if ( buffer && !buffer.contains(x, y) ) this.dismissLockedTooltips();
  }

  /* -------------------------------------------- */

  /**
    * Dismiss the set of active locked tooltips.
    */
  dismissLockedTooltips() {
    for ( const element of this.#locked.elements.values() ) {
      element.remove();
    }
    this.#locked.elements = new Set();
  }

  /* -------------------------------------------- */

  /**
    * Create a locked tooltip at the given position.
    * @param {object} position             A position object with coordinates for where the tooltip should be placed
    * @param {string} position.top         Explicit top position for the tooltip
    * @param {string} position.right       Explicit right position for the tooltip
    * @param {string} position.bottom      Explicit bottom position for the tooltip
    * @param {string} position.left        Explicit left position for the tooltip
    * @param {string} text                 Explicit tooltip text or HTML to display.
    * @param {object} [options={}]         Additional options which can override tooltip behavior.
    * @param {array} [options.cssClass]    An optional, space-separated list of CSS classes to apply to the activated
    *                                      tooltip.
    * @returns {HTMLElement}
    */
  createLockedTooltip(position, text, {cssClass}={}) {
    this.#clearDeactivation();
    this.tooltip.innerHTML = text;
    this.tooltip.style.top = position.top || "";
    this.tooltip.style.right = position.right || "";
    this.tooltip.style.bottom = position.bottom || "";
    this.tooltip.style.left = position.left || "";

    const clone = this.lockTooltip();
    if ( cssClass ) clone.classList.add(...cssClass.split(" "));
    return clone;
  }

  /* -------------------------------------------- */

  /**
    * If an explicit tooltip expansion direction was not specified, figure out a valid direction based on the bounds
    * of the target element and the screen.
    * @protected
    */
  _determineDirection() {
    const pos = this.element.getBoundingClientRect();
    const dirs = this.constructor.TOOLTIP_DIRECTIONS;
    return dirs[pos.y + this.tooltip.offsetHeight > window.innerHeight ? "UP" : "DOWN"];
  }

  /* -------------------------------------------- */

  /**
    * Set tooltip position relative to an HTML element using an explicitly provided data-tooltip-direction.
    * @param {TooltipManager.TOOLTIP_DIRECTIONS} direction  The tooltip expansion direction specified by the element
    *                                                        or a parent element.
    * @protected
    */
  _setAnchor(direction) {
    const directions = this.constructor.TOOLTIP_DIRECTIONS;
    const pad = this.constructor.TOOLTIP_MARGIN_PX;
    const pos = this.element.getBoundingClientRect();
    let style = {};
    switch ( direction ) {
      case directions.DOWN:
        style.textAlign = "center";
        style.left = pos.left - (this.tooltip.offsetWidth / 2) + (pos.width / 2);
        style.top = pos.bottom + pad;
        break;
      case directions.LEFT:
        style.textAlign = "left";
        style.right = window.innerWidth - pos.left + pad;
        style.top = pos.top + (pos.height / 2) - (this.tooltip.offsetHeight / 2);
        break;
      case directions.RIGHT:
        style.textAlign = "right";
        style.left = pos.right + pad;
        style.top = pos.top + (pos.height / 2) - (this.tooltip.offsetHeight / 2);
        break;
      case directions.UP:
        style.textAlign = "center";
        style.left = pos.left - (this.tooltip.offsetWidth / 2) + (pos.width / 2);
        style.bottom = window.innerHeight - pos.top + pad;
        break;
      case directions.CENTER:
        style.textAlign = "center";
        style.left = pos.left - (this.tooltip.offsetWidth / 2) + (pos.width / 2);
        style.top = pos.top + (pos.height / 2) - (this.tooltip.offsetHeight / 2);
        break;
    }
    return this._setStyle(style);
  }

  /* -------------------------------------------- */

  /**
    * Apply inline styling rules to the tooltip for positioning and text alignment.
    * @param {object} [position={}]  An object of positioning data, supporting top, right, bottom, left, and textAlign
    * @protected
    */
  _setStyle(position={}) {
    const pad = this.constructor.TOOLTIP_MARGIN_PX;
    position = {top: null, right: null, bottom: null, left: null, textAlign: "left", ...position};
    const style = this.tooltip.style;

    // Left or Right
    const maxW = window.innerWidth - this.tooltip.offsetWidth;
    if ( position.left ) position.left = Math.clamped(position.left, pad, maxW - pad);
    if ( position.right ) position.right = Math.clamped(position.right, pad, maxW - pad);

    // Top or Bottom
    const maxH = window.innerHeight - this.tooltip.offsetHeight;
    if ( position.top ) position.top = Math.clamped(position.top, pad, maxH - pad);
    if ( position.bottom ) position.bottom = Math.clamped(position.bottom, pad, maxH - pad);

    // Assign styles
    for ( let k of ["top", "right", "bottom", "left"] ) {
      const v = position[k];
      style[k] = v ? v + "px" : null;
    }

    this.tooltip.classList.remove(...["center", "left", "right"].map(dir => "text-" + dir));
    this.tooltip.classList.add("text-" + position.textAlign);
  }
}
      
window.tooltip_manager = new TooltipManager();
console.log("#------>", window.tooltip_manager.tooltip);
`;
  }

  log(msg, ...args) {
    // eslint-disable-next-line no-undef
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
    /* eslint-disable no-undef */
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
    /* eslint-enable no-undef */

    // We replace the games window registry with a proxy object so we can intercept
    // every new application window creation event.
    const handler = {
      ownKeys: (target) => {
        return Reflect.ownKeys(target).filter((app) => {
          const appId = parseInt(app);
          if (!isNaN(appId)) {
            return !this.poppedOut.has(appId);
          }
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
    ui.windows = new Proxy(ui.windows, handler); // eslint-disable-line no-undef
    this.log("Installed window interceptor", ui.windows); // eslint-disable-line no-undef

    // COMPAT(posnet: 2022-09-24) v10 prosemirror
    // This is very stupid and bad, but people seem unaware that getElementById is not good.
    // In theory this might have performance issues, but I don't care at this point.
    // And it does fix the problem with prosemirror, and will help with any other modules making
    // the same mistake.
    // eslint-disable-next-line no-undef
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
    // eslint-disable-next-line no-undef
    libWrapper.register(
      "popout",
      "game.keyboard.hasFocus",
      () => {
        const formElements = [
          "input",
          "select",
          "textarea",
          "option",
          "button",
          "[contenteditable]",
        ];
        const selector = formElements.map((el) => `${el}:focus`).join(", ");
        var hasFocus = document.querySelectorAll(selector).length > 0;
        for (const val of this.poppedOut.values()) {
          hasFocus =
            hasFocus ||
            val.window.document.querySelectorAll(selector).length > 0;
        }
        return hasFocus;
      },
      "OVERRIDE"
    );

    // NOTE(posnet: 2020-07-12): we need to initialize TinyMCE to ensure its plugins,
    // are loaded into the frame. Otherwise our popouts will not be able to access
    // the lazy loaded JavaScript mce plugins.
    // This will affect any module that lazy loads JavaScript. And require special handling.
    /* eslint-disable no-undef */
    const elem = $(
      `<div style="display: none;"><p id="mce_init"> foo </p></div>`
    );
    $("body").append(elem);
    const config = { target: elem[0], plugins: CONFIG.TinyMCE.plugins };
    const editor = await tinyMCE.init(config);
    editor[0].remove();
    /* eslint-enable no-undef */
  }

  async addPopout(app) {
    if (
      app._disable_popout_module !== undefined &&
      app._disable_popout_module
    ) {
      this.log("Ignoring app marked as do not popout", app);
      return;
    }
    if (this.poppedOut.has(app.appId)) {
      this.log("Already popped out");
      this.poppedOut.get(app.appId).window.focus();
      return;
    }

    let waitRender = Math.floor(this.MAX_TIMEOUT / this.TIMEOUT_INTERVAL);
    while (
      app._state !== Application.RENDER_STATES.RENDERED && // eslint-disable-line no-undef
      waitRender-- > 0
    ) {
      await new Promise((r) => setTimeout(r, this.TIMEOUT_INTERVAL));
    }
    // eslint-disable-next-line no-undef
    if (app._state !== Application.RENDER_STATES.RENDERED) {
      this.log("Timeout out waiting for app to render");
      return;
    }

    if (this.handleChildDialog(app)) {
      return;
    }

    let domID = this.appToID(app);
    if (!document.getElementById(domID)) {
      // Don't create a second link on re-renders;
      /* eslint-disable no-undef */
      // class "header-button" is for compatibility with 🦋 Monarch
      let buttonText = game.i18n.localize("POPOUT.PopOut");
      if (game && game.settings.get("popout", "iconOnly")) {
        buttonText = "";
      }
      const link = $(
        `<a id="${domID}" class="popout-module-button"><i class="fas fa-external-link-alt" title="${game.i18n.localize(
          "POPOUT.PopOut"
        )}"></i>${buttonText}</a>`
      );
      /* eslint-enable no-undef */

      link.on("click", () => this.onPopoutClicked(app));
      // eslint-disable-next-line no-undef
      if (game && game.settings.get("popout", "showButton")) {
        app.element.find(".window-title").after(link);
      }
      this.log("Attached", app);
    }
  }

  appToID(app) {
    const domID = `popout_${this.ID}_${app.appId}`;
    return domID;
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
        // We only nest popout intercepted application if they extend the Dialog class.
        // eslint-disable-next-line no-undef
        if (app instanceof Dialog) {
          this.log("Intercepting likely dialog of popped out window.", app);
          this.moveDialog(app, state.app);
          return true;
        }
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
    parentApp.element[0].style.zIndex = 0;

    // We manually intercept the setPosition function of the dialog app in
    // order to handle re-renders that change the position.
    // In particular the FilePicker application.
    // eslint-disable-next-line no-unused-vars

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
    Hooks.callAll("PopOut:dialog", app, parent); // eslint-disable-line no-undef
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
      true
    );
    const body = document.importNode(
      document.getElementsByTagName("body")[0],
      false
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

    // COMPAT(posnet: 2022-05-05):
    // Last ditch effort to support tooltips. By far the worst hack I've needed to do.
    // Basically I have just embedded a copy of the TooltipManager class from the base game directly
    // into the popped out window because all other attempts to hack arround it have failed,
    // either because it's extensive use of window and document methods, or the fact that it uses
    // private js members. If this breaks again, I will most likely just leave it broken.
    const tooltipNode = document.createElement("aside");
    tooltipNode.id = "tooltip";
    tooltipNode.role = "tooltip";
    body.appendChild(tooltipNode);

    const tooltipFix = document.createElement("script");
    tooltipFix.appendChild(document.createTextNode(this.TOOLTIP_CODE));
    head.append(tooltipFix);

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

    // eslint-disable-next-line no-undef
    if (game.settings.get("popout", "useWindows")) {
      const position = app.element.position(); // JQuery position function.
      let width = app.element.innerWidth();
      let height = app.element.innerHeight();
      let left = position.left;
      let top = position.top;
      // eslint-disable-next-line no-undef
      if (game && game.settings.get("popout", "trueBoundingBox")) {
        // eslint-disable-line no-undef
        const bounding = this.recursiveBoundingBox(app.element[0]);
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
      ui.notifications.warn(game.i18n.localize("POPOUT.electronWarning")); // eslint-disable-line no-undef
      return;
    }

    if (window.ui.windows[app.appId] === undefined) {
      // eslint-disable-line no-undef
      this.log("Attempt to open not a user interface window.");
      return;
    }

    if (this.poppedOut.has(app.appId)) {
      // This check is to ensure PopOut is idempotent to popout calls.
      let currentState = this.poppedOut.get(app.appId);
      if (currentState && currentState.window && !currentState.window.closed) {
        currentState.window.focus();
        return;
      } else if (
        currentState &&
        currentState.window &&
        currentState.window.closed
      ) {
        this.poppedOut.delete(app.appId);
      }
    }

    const { windowFeatures, offsets } = this.windowFeatures(app);
    this.log("Features", windowFeatures, offsets);

    // -------------------- Obtain application --------------------
    const state = {
      app: app,
      node: app.element[0],
      position: duplicate(app.position), // eslint-disable-line no-undef
      minimized: app._minimized,
      display: app.element[0].style.display,
      css: app.element[0].style.cssText,
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
      ui.notifications.warn(game.i18n.localize("POPOUT.failureWarning")); // eslint-disable-line no-undef
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
    let domID = this.appToID(app);
    for (const child of [...state.header.children]) {
      if (child.id == domID) {
        // Change Close button
        /* eslint-disable no-unused-vars, no-undef */

        let buttonText = game.i18n.localize("POPOUT.PopIn");
        if (game && game.settings.get("popout", "iconOnly")) {
          buttonText = "";
        }

        $(child)
          .html(
            `<i class="fas fa-sign-in-alt" title="${game.i18n.localize(
              "POPOUT.PopIn"
            )}"></i>${buttonText}`
          )
          .off("click")
          .on("click", (event) => {
            popout._popout_dont_close = true;
            popout.close();
          });
        /* eslint-enable no-unused-vars, no-undef */
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

    Hooks.callAll("PopOut:loading", app, popout); // eslint-disable-line no-undef

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
        app.bringToTop = poppedOut.bringToTop;
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

        // Force a re-render or close it
        if (popout._popout_dont_close) {
          Hooks.callAll("PopOut:popin", app); // eslint-disable-line no-undef
          await app.render(true);
          this.addPopout(app);
        } else {
          Hooks.callAll("PopOut:close", app, node); // eslint-disable-line no-undef
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
        ui.notifications.warn(game.i18n.localize("POPOUT.failureWarning")); // eslint-disable-line no-undef
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

      // eslint-disable-next-line no-undef
      if (game.release.generation >= 10) {
        const allFonts = FontConfig._collectDefinitions(); // eslint-disable-line no-undef
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
            } catch {} // eslint-disable-line no-empty
          }
        });
      }

      const body = event.target.getElementsByTagName("body")[0];
      const node = targetDoc.adoptNode(state.node);
      body.style.overflow = "auto";
      body.append(state.node);

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
        ev.preventDefault()
      );
      // Disable mouse 3, 4, and 5
      popout.document.addEventListener("pointerdown", (ev) => {
        if ([3, 4, 5].includes(ev.button)) ev.preventDefault();
      });

      popout.addEventListener("keydown", (event) =>
        window.keyboard._handleKeyboardEvent(event, false)
      );
      popout.addEventListener("keyup", (event) =>
        window.keyboard._handleKeyboardEvent(event, true)
      );

      // COMPAT(posnet: 2022-09-17) v9
      // eslint-disable-next-line no-undef
      if (game.release.generation < 10) {
        // From: TextEditor.activateListeners();
        // These event listeners don't get migrated because they are attached to a jQuery
        // selected body. This could be more of an issue in future as anyone doing a delegated
        // event handler will also fail. But that is bad practice.
        // The following regex will find examples of delegated event handlers in foundry.js
        // `on\(("|')[^'"]+("|'), *("|')`
        const jBody = $(body); // eslint-disable-line no-undef
        jBody.on(
          "click",
          "a.entity-link",
          window.TextEditor._onClickEntityLink !== undefined
            ? window.TextEditor._onClickEntityLink
            : window.TextEditor._onClickContentLink
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
      } else {
        // From: TextEditor.activateListeners();
        // These event listeners don't get migrated because they are attached to a jQuery
        // selected body. This could be more of an issue in future as anyone doing a delegated
        // event handler will also fail. But that is bad practice.
        // The following regex will find examples of delegated event handlers in foundry.js
        // `on\(("|')[^'"]+("|'), *("|')`
        const jBody = $(body); // eslint-disable-line no-undef
        jBody.on(
          "click",
          "a.content-link",
          window.TextEditor._onClickEntityLink !== undefined
            ? window.TextEditor._onClickEntityLink
            : window.TextEditor._onClickContentLink
        );
        jBody.on(
          "dragstart",
          "a.content-link",
          window.TextEditor._onDragEntityLink !== undefined
            ? window.TextEditor._onDragEntityLink
            : window.TextEditor._onDragContentLink
        );
        jBody.on(
          "click",
          "a.inline-roll",
          window.TextEditor._onClickInlineRoll
        );
      }

      popout.game = game; // eslint-disable-line no-undef
      popout.tooltip_manager.tooltip =
        popout.document.getElementById("tooltip");
      popout.tooltip_manager.activateEventListeners();

      this.log("Final node", node, app);
      Hooks.callAll("PopOut:loaded", app, node); // eslint-disable-line no-undef
    });

    // -------------------- Install intercept methods ----------------

    const oldBringToTop = app.bringToTop.bind(app);
    app.bringToTop = (...args) => {
      this.log("Intercepted popout bringToTop", app);
      popout.focus();
      const result = oldBringToTop.apply(app, args);
      // In a popout we always want the base sheet to be at the back.
      app.element[0].style.zIndex = 0;
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
      // eslint-disable-next-line no-undef
      if (game.keyboard.isDown !== undefined) {
        // COMPAT(posnet: 2022-09-17) v9 compat
        if (game.keyboard.isDown("Escape")) return; // eslint-disable-line no-undef
      } else {
        if (game.keyboard.downKeys.has("Escape")) return; // eslint-disable-line no-undef
      }
      popout.close();
      return oldClose.apply(app, args);
    };

    const oldMinimize = app.minimize.bind(app);
    app.minimize = (...args) => {
      this.log("Trying to focus main window.", app); // Doesn't appear to work due to popout blockers.
      popout._rootWindow.focus();
      if (popout._rootWindow.getAttention) {
        popout._rootWindow.getAttention();
      }
      return oldMinimize.apply(app, args);
    };

    const oldMaximize = app.maximize.bind(app);
    app.maximize = (...args) => {
      popout.focus();
      this.log("Trying to focus popout.", popout);
      return oldMaximize.apply(app, args);
    };

    const oldSetPosition = app.setPosition.bind(app);
    app.setPosition = (...args) => {
      if (this.poppedOut.has(app.appId)) {
        this.log(
          "Intercepted application setting position",
          app.constructor.name
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
    this.poppedOut.set(app.appId, state);
    Hooks.callAll("PopOut:popout", app, popout); // eslint-disable-line no-undef
  }

  // Public API
  static popoutApp(app) {
    if (PopoutModule.singleton) {
      PopoutModule.singleton.onPopoutClicked(app);
    }
  }
}

/* eslint-disable no-undef */
Hooks.on("ready", () => {
  PopoutModule.singleton = new PopoutModule();
  PopoutModule.singleton.init();

  // eslint-disable-next-line no-unused-vars
  Hooks.on("PopOut:loaded", async (app, node) => {
    // PDFoundry
    if (window.ui.PDFoundry !== undefined) {
      app._viewer = false;
      if (app.pdfData && app.pdfData.url !== undefined) {
        app.open(
          new URL(app.pdfData.url, window.location).href,
          app.pdfData.offset
        );
      }
      if (app.onViewerReady !== undefined) {
        app.onViewerReady();
      }
    }
    return;
  });

  // eslint-disable-next-line no-unused-vars
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
/* eslint-enable no-undef */
