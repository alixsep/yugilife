/** @type {import("prettier").Config} */
const config = {
  semi: false,
  singleQuote: false,
  trailingComma: "all",
  printWidth: 100,
  tabWidth: 2,
  arrowParens: "always",
  plugins: ["prettier-plugin-tailwindcss"],
}

export default config
