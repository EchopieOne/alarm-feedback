const { major, minor, patch } = parseVersion(process.versions.node);

const supported =
  (major === 20 && minor >= 19) ||
  (major === 22 && (minor > 12 || (minor === 12 && patch >= 0))) ||
  major > 22;

if (!supported) {
  console.error(
    [
      `Unsupported Node.js ${process.version}.`,
      "This project uses Vite 7, which requires Node.js 20.19.x or 22.12+.",
      "Run `nvm use` from the repo root, or install the pinned version with `nvm install 22.12.0`."
    ].join("\n")
  );
  process.exit(1);
}

function parseVersion(version) {
  const [major, minor, patch] = version.split(".").map((part) => Number.parseInt(part, 10));
  return { major, minor, patch };
}
