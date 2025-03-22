import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { Position } from "@/types";

const dataFilePath = path.join(process.cwd(), "src/data/positions.json");

export async function GET() {
  try {
    const fileContents = await fs.readFile(dataFilePath, "utf8");
    return NextResponse.json(JSON.parse(fileContents));
  } catch (error) {
    console.log(error);
    return NextResponse.json({ positions: [] });
  }
}

export async function POST(request: Request) {
  try {
    const position: Position = await request.json();
    const fileContents = await fs.readFile(dataFilePath, "utf8");
    const data = JSON.parse(fileContents);

    data.positions.push(position);

    await fs.writeFile(dataFilePath, JSON.stringify(data, null, 2));

    return NextResponse.json(data);
  } catch (error) {
    console.log(error);
    return NextResponse.json(
      { error: "Failed to save position" },
      { status: 500 }
    );
  }
}
