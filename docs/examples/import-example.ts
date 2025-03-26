/**
 * Example script demonstrating the usage of the portfolio import system
 */

import {
  importFromJson,
  importFromFile,
  importMultipleFromJson,
} from "@/utilities/data-import/import-service";
import fs from "fs/promises";
import path from "path";

async function main() {
  try {
    // Example 1: Import from JSON string
    const jsonString = await fs.readFile(
      path.join(__dirname, "portfolio-import-example.json"),
      "utf-8"
    );

    console.log("Example 1: Importing from JSON string");
    const result1 = await importFromJson(jsonString);
    if (result1.success && result1.data) {
      console.log("Successfully imported portfolio:", result1.data.name);
      console.log("Current value:", result1.data.currentValue);
      console.log("Return percentage:", result1.data.returnPercentage);
    } else {
      console.error("Import failed:", result1.error?.message);
    }

    // Example 2: Import multiple portfolios
    const multiplePortfolios = [
      JSON.parse(jsonString),
      {
        ...JSON.parse(jsonString),
        id: "example-portfolio-2",
        name: "Example Portfolio 2",
      },
    ];

    console.log("\nExample 2: Importing multiple portfolios");
    const results2 = await importMultipleFromJson(
      JSON.stringify(multiplePortfolios)
    );
    console.log(
      `Successfully imported ${
        results2.filter(r => r.success).length
      } portfolios`
    );
    results2.forEach((result, index) => {
      if (result.success && result.data) {
        console.log(`Portfolio ${index + 1}:`, result.data.name);
      } else {
        console.error(
          `Portfolio ${index + 1} import failed:`,
          result.error?.message
        );
      }
    });

    // Example 3: Import with custom options
    console.log("\nExample 3: Importing with custom options");
    const result3 = await importFromJson(jsonString, {
      validate: true,
      normalizeDates: true,
      normalizeNumbers: true,
      normalizeBooleans: true,
      strict: true,
    });

    if (result3.success && result3.data) {
      console.log("Successfully imported portfolio with custom options");
      console.log("Date created (normalized):", result3.data.dateCreated);
      console.log("Is public (normalized):", result3.data.isPublic);
    } else {
      console.error(
        "Import with custom options failed:",
        result3.error?.message
      );
    }
  } catch (error) {
    console.error("Error running examples:", error);
  }
}

// Run the examples
main();
