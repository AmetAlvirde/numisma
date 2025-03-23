import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { Position } from "@/types";

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const positionsPath = path.join(process.cwd(), "data", "positions.json");
    const positionsData = await fs.readFile(positionsPath, "utf-8");
    const positions: Position[] = JSON.parse(positionsData);

    const position = positions.find(p => p.id === params.id);

    if (!position) {
      return NextResponse.json(
        { error: "Position not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(position);
  } catch (error) {
    console.error("Error fetching position:", error);
    return NextResponse.json(
      { error: "Failed to fetch position" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const positionsPath = path.join(process.cwd(), "data", "positions.json");
    const positionsData = await fs.readFile(positionsPath, "utf-8");
    const positions: Position[] = JSON.parse(positionsData);

    const updatedPosition: Position = await request.json();

    // Validate that the position exists
    const positionIndex = positions.findIndex(p => p.id === params.id);
    if (positionIndex === -1) {
      return NextResponse.json(
        { error: "Position not found" },
        { status: 404 }
      );
    }

    // Validate that the ID matches
    if (updatedPosition.id !== params.id) {
      return NextResponse.json(
        { error: "Position ID mismatch" },
        { status: 400 }
      );
    }

    // Update the position
    positions[positionIndex] = updatedPosition;

    // Write back to file
    await fs.writeFile(positionsPath, JSON.stringify(positions, null, 2));

    return NextResponse.json({
      success: true,
      data: updatedPosition,
    });
  } catch (error) {
    console.error("Error updating position:", error);
    return NextResponse.json(
      { error: "Failed to update position" },
      { status: 500 }
    );
  }
}
