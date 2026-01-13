import { test, expect } from "@playwright/test";

test.describe("File Upload/Download Tests", () => {
  const testFileName = `test-file-${Date.now()}.txt`;
  const testFileContent = "Hello, this is a test file content!";

  test("Upload file via /api/upload", async ({ request }) => {
    // Create a file-like object for upload
    const response = await request.post("/api/upload", {
      multipart: {
        file: {
          name: testFileName,
          mimeType: "text/plain",
          buffer: Buffer.from(testFileContent),
        },
      },
    });

    expect(response.ok()).toBe(true);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.name).toBe(testFileName);
    expect(data.size).toBe(testFileContent.length);
  });

  test("List files via /api/files", async ({ request }) => {
    // First upload a file to ensure there's something to list
    await request.post("/api/upload", {
      multipart: {
        file: {
          name: testFileName,
          mimeType: "text/plain",
          buffer: Buffer.from(testFileContent),
        },
      },
    });

    const response = await request.get("/api/files");

    expect(response.ok()).toBe(true);
    expect(response.status()).toBe(200);

    const data = await response.json();
    expect(data.files).toBeDefined();
    expect(Array.isArray(data.files)).toBe(true);

    // Find our uploaded file
    const uploadedFile = data.files.find(
      (f: { name: string }) => f.name === testFileName
    );
    expect(uploadedFile).toBeDefined();
    expect(uploadedFile.size).toBe(testFileContent.length);
  });

  test("Download file via /api/files/:name", async ({ request }) => {
    // First upload a file
    await request.post("/api/upload", {
      multipart: {
        file: {
          name: testFileName,
          mimeType: "text/plain",
          buffer: Buffer.from(testFileContent),
        },
      },
    });

    // Download it
    const response = await request.get(`/api/files/${testFileName}`);

    expect(response.ok()).toBe(true);
    expect(response.status()).toBe(200);

    const content = await response.text();
    expect(content).toBe(testFileContent);
  });

  test("Delete file via DELETE /api/files/:name", async ({ request }) => {
    const deleteFileName = `delete-test-${Date.now()}.txt`;

    // First upload a file
    await request.post("/api/upload", {
      multipart: {
        file: {
          name: deleteFileName,
          mimeType: "text/plain",
          buffer: Buffer.from("content to delete"),
        },
      },
    });

    // Delete it
    const deleteResponse = await request.delete(`/api/files/${deleteFileName}`);
    expect(deleteResponse.ok()).toBe(true);

    const deleteData = await deleteResponse.json();
    expect(deleteData.success).toBe(true);
    expect(deleteData.deleted).toBe(deleteFileName);

    // Verify it's gone
    const getResponse = await request.get(`/api/files/${deleteFileName}`);
    expect(getResponse.status()).toBe(404);
  });

  test("Download nonexistent file returns 404", async ({ request }) => {
    const response = await request.get("/api/files/nonexistent-file.txt");

    expect(response.status()).toBe(404);

    const data = await response.json();
    expect(data.error).toBe("File not found");
  });

  test("Upload without file returns 400", async ({ request }) => {
    const response = await request.post("/api/upload", {
      multipart: {},
    });

    expect(response.status()).toBe(400);

    const data = await response.json();
    expect(data.error).toBe("No file provided");
  });
});
