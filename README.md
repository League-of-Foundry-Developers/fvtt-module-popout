# PopOut!

This Foundry VTT module lets you pop out actor sheets and journal entries into their own windows.

Note that this module does not work within the Electron window (the standalone FVTT Application) and can only be used from regular browsers.

# Installation
Install using the URL : `https://raw.githubusercontent.com/League-of-Foundry-Developers/fvtt-module-popout/master/module.json`

As DM go to the `Manage Modules` options menu in your Game Settings tab then enable the `PopOut!` module.

# Module Developers
Popout! exposes a single API function and a series of hooks so other modules can leverage it's functionality.

To Popout an application call the function with the application object.

```js
// Where app is the top level Application foundry object.
PopoutModule.popoutApp(app);
```

Hooks.callAll("PopOut:popout", app, popout, state);
Hooks.callAll("PopOut:popin", app);
Hooks.callAll("PopOut:dialog", app, parent);
Hooks.callAll("PopOut:close", app, node);
Hooks.callAll("Popout:loaded", app, node);


# License
This Foundry VTT module, written by @KaKaRoTo.
It is currently maintained by @Posnet.
It is licensed under a [Creative Commons Attribution 4.0 International License](http://creativecommons.org/licenses/by/4.0/).

This work is licensed under Foundry Virtual Tabletop [EULA - Limited License Agreement for module development v 0.1.6](http://foundryvtt.com/pages/license.html).
