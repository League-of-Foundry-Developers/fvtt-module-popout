import globals from "globals";

export default [
  {
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.jquery,
        // Foundry VTT globals
        game: "readonly",
        ui: "readonly",
        foundry: "readonly",
        CONFIG: "readonly",
        tinyMCE: "readonly",
        randomID: "readonly",
        duplicate: "readonly",
        Application: "readonly",
        Dialog: "readonly",
        FontConfig: "readonly",
        Hooks: "readonly",
        $: "readonly",
        jQuery: "readonly"
      }
    },
    rules: {
      // Add any custom rules here
    }
  }
];