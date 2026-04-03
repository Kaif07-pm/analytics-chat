/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      boxShadow: {
        sm: "0 1px 2px 0 rgb(15 23 42 / 0.05)",
        md: "0 4px 10px 0 rgb(15 23 42 / 0.08)"
      }
    }
  },
  plugins: []
};

