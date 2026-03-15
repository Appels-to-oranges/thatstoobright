const path = require("path");
const fs = require("fs");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "win32") return;

  const exeName =
    fs.readdirSync(context.appOutDir).find((name) => name.toLowerCase().endsWith(".exe")) ||
    "ThatsTooBright.exe";
  const exePath = path.join(context.appOutDir, exeName);
  const iconPath = path.resolve(__dirname, "..", "build", "icon.ico");
  const { rcedit } = await import("rcedit");

  await rcedit(exePath, {
    icon: iconPath,
    "version-string": {
      CompanyName: "payso",
      FileDescription: "ThatsTooBright",
      ProductName: "ThatsTooBright",
      InternalName: "ThatsTooBright",
      OriginalFilename: exeName,
    },
  });
};
