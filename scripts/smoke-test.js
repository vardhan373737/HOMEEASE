const baseUrl = process.env.BASE_URL || "http://localhost:5000";

async function assertOk(path, validator) {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed for ${path}: ${res.status}`);
  }
  const bodyText = await res.text();
  if (typeof validator === "function") {
    validator(bodyText, res);
  }
  console.log(`PASS ${path}`);
}

async function main() {
  await assertOk("/api/health", (text) => {
    const data = JSON.parse(text);
    if (!data || data.ok !== true) {
      throw new Error("/api/health did not return ok=true");
    }
  });

  await assertOk("/api/services", (text) => {
    const data = JSON.parse(text);
    if (!Array.isArray(data)) {
      throw new Error("/api/services did not return an array");
    }
  });

  await assertOk("/", (text) => {
    if (!text.includes("HomeEase Services")) {
      throw new Error("Homepage does not contain expected brand text");
    }
  });

  console.log("Smoke tests completed successfully.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
