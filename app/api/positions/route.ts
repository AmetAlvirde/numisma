import { NextResponse } from "next/server";
import { Position } from "@/types";
import { promises as fs } from "fs";
import path from "path";

const positionsFilePath = path.join(process.cwd(), "data", "positions.json");

// Ensure the data directory exists
async function ensureDataDirectory() {
  try {
    await fs.access(path.join(process.cwd(), "data"));
  } catch (error) {
    console.log("Creating data directory...");
    await fs.mkdir(path.join(process.cwd(), "data"));
  }
}

// Initialize positions file if it doesn't exist
async function ensurePositionsFile() {
  try {
    await fs.access(positionsFilePath);
  } catch (error) {
    console.log("Creating positions.json file...");
    await fs.writeFile(positionsFilePath, JSON.stringify([], null, 2));
  }
}

export async function POST(request: Request) {
  try {
    console.log("Received POST request to /api/positions");
    const newPosition = await request.json();
    console.log("New position data:", JSON.stringify(newPosition, null, 2));

    // Ensure data directory and file exist
    await ensureDataDirectory();
    await ensurePositionsFile();

    // Read existing positions
    console.log("Reading existing positions from file...");
    const fileContents = await fs.readFile(positionsFilePath, "utf8");
    const positions = JSON.parse(fileContents);
    console.log(`Found ${positions.length} existing positions`);

    // Check for duplicate position by ID
    const isDuplicate = positions.some(
      (pos: Position) => pos.id === newPosition.id
    );
    if (isDuplicate) {
      console.log("Duplicate position detected, skipping...");
      return NextResponse.json(
        { success: false, error: "Position with this ID already exists" },
        { status: 400 }
      );
    }

    // Add new position
    positions.push(newPosition);

    // Write back to file
    console.log("Writing updated positions to file...");
    await fs.writeFile(positionsFilePath, JSON.stringify(positions, null, 2));
    console.log("Successfully saved new position");

    return NextResponse.json({ success: true, data: newPosition });
  } catch (error) {
    console.error("Error creating position:", error);
    if (error instanceof Error) {
      console.error("Error details:", {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
    }
    return NextResponse.json(
      { success: false, error: "Failed to create position" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    // Ensure data directory and file exist
    await ensureDataDirectory();
    await ensurePositionsFile();

    const fileContents = await fs.readFile(positionsFilePath, "utf8");
    const positions = JSON.parse(fileContents);
    return NextResponse.json(positions);
  } catch (error) {
    console.error("Error reading positions:", error);
    if (error instanceof Error) {
      console.error("Error details:", {
        name: error.name,
        message: error.message,
        stack: error.stack,
      });
    }
    return NextResponse.json(
      { success: false, error: "Failed to read positions" },
      { status: 500 }
    );
  }
}
