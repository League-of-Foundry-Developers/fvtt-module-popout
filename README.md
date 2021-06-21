# PopOut!

This Foundry VTT module lets you pop out actor sheets and journal entries into their own windows.

Note that this module does not work within the Electron window (the standalone FVTT Application) and can only be used from regular browsers.

# Installation
Install using the URL : `https://raw.githubusercontent.com/League-of-Foundry-Developers/fvtt-module-popout/master/module.json`

As DM go to the `Manage Modules` options menu in your Game Settings tab then enable the `PopOut!` module.

# Module Developers
Popout! exposes a single API function and a series of hooks so other modules can leverage it's functionality.

This API is new as of version 2.0, and I will strive to maintain API compatibility from this point on.

*Note*: There was a minor compatibility break which is why 2.0 was released, the PopOut hook now only takes 2 arguments instead of 3.

To PopOut an application call the function with the application object.

```js
// Where app is the top level Application foundry object.
PopoutModule.popoutApp(app);
```

PopOut also exposes hooks to developers to alter its behavior to add compatibility to their modules.
For an example of what that might look like, see the PDFoundry compatibility hooks in [./popout.js#675](./popout.js#675)

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
It is licensed under a [Creative Commons Attribution 4.0 International License](http://creativecommons.org/licenses/by/4.0/).

This work is licensed under Foundry Virtual Tabletop [EULA - Limited License Agreement for module development v 0.1.6](http://foundryvtt.com/pages/license.html).
