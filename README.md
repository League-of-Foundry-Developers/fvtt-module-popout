# [PopOut!](https://foundryvtt.com/packages/popout)

This Foundry VTT module lets you pop out actor sheets and journal entries into their own windows.

Note that this module does not work within the Electron window (the standalone FVTT Application) and can only be used from regular browsers.

# Installation
Install using the URL : `https://raw.githubusercontent.com/League-of-Foundry-Developers/fvtt-module-popout/master/module.json`

As DM go to the `Manage Modules` options menu in your Game Settings tab then enable the `PopOut!` module.

# Module Developers
Popout! exposes a single API function and a series of hooks so other modules can leverage it's functionality.

This API is new as of version 2.0, with the goal is to maintain API compatibility from this point on.

*Note*: There was a minor compatibility break which is why 2.0 was released, the PopOut hook now only takes 2 arguments instead of 3.

To pop out an application, call the function with the application object.

```js
// Where app is the foundry Application object. For example an actor sheet.
// If the Application exists in the window.ui.windows map, it should be able to be popped out.
PopoutModule.popoutApp(app);
```

PopOut also exposes hooks to developers to alter its behavior to add compatibility to their modules.
For an example of what that might look like, see the PDFoundry compatibility hooks in [./popout.js](./popout.js#697)

```javascript
// app: is the foundry application being popped out.
// popout: is the browser window object where the popped out element will be moved.
Hooks.callAll("PopOut:popout", app, popout);

// app: is the foundry application being popped out.
// node: is the html element of the application after it has been moved to the new window.
Hooks.callAll("Popout:loaded", app, node);

// app: is the foundry application being popped in.
Hooks.callAll("PopOut:popin", app);

// app: is the foundry application being popped out.
// parent: The application that PopOut believes owns the diaglog box.
Hooks.callAll("PopOut:dialog", app, parent);

// app: is the foundry application being popped out.
// node: is the html element of the popped out application, before it is deleted or popped in.
Hooks.callAll("PopOut:close", app, node);
```


# License
This Foundry VTT module, written by @KaKaRoTo.
It is currently maintained by @Posnet.

This work is licensed under Foundry Virtual Tabletop [EULA - LIMITED LICENSE AGREEMENT FOR MODULE DEVELOPMENT](https://foundryvtt.com/article/license/)

The contents of this module are licensed under a [Creative Commons Attribution 4.0 International License](./LICENSE.txt) where they do not conflict with the above Foundry License.