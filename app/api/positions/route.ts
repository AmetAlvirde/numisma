import { NextResponse } from "next/server";
import { Position } from "@/types";
import { promises as fs } from "fs";
import path from "path";

const positionsFilePath = path.join(process.cwd(), "data", "positions.json");

// Ensure the data directory exists
if (!fs.access(path.join(process.cwd(), "data"))) {
  fs.mkdir(path.join(process.cwd(), "data"));
}

// Initialize positions file if it doesn't exist
if (!fs.access(positionsFilePath)) {
  fs.writeFile(positionsFilePath, JSON.stringify([], null, 2));
}

export async function POST(request: Request) {
  try {
    const newPosition = await request.json();

    // Read existing positions
    const fileContents = await fs.readFile(positionsFilePath, "utf8");
    const positions = JSON.parse(fileContents);

    // Add new position
    positions.push(newPosition);

    // Write back to file
    await fs.writeFile(positionsFilePath, JSON.stringify(positions, null, 2));

    return NextResponse.json(newPosition);
  } catch (error) {
    console.error("Error creating position:", error);
    return NextResponse.json(
      { error: "Failed to create position" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const fileContents = await fs.readFile(positionsFilePath, "utf8");
    const positions = JSON.parse(fileContents);
    return NextResponse.json(positions);
  } catch (error) {
    console.error("Error reading positions:", error);
    return NextResponse.json(
      { error: "Failed to read positions" },
      { status: 500 }
    );
  }
}
