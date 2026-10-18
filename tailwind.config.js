module.exports = {
  content: ["./views/**/*.ejs", "./public/js/**/*.js"],
  theme: { extend: {
    colors: { bgBase: "#fdfbf7", main: "#544A47", accent: "#BA2636", sub1: "#8D837F", bgAccentMain: "#FDF2F3", gold: "#C5A059", ink: "#17211b", moss: "#486154", paper: "#f7f7f4", line: "#e5e7e3", brand: "#ba2636" },
    fontFamily: { serif: ["Georgia", "serif"] },
    animation: { "pulse-slow": "pulse 3s ease-in-out infinite" },
  } },
  plugins: [],
};
