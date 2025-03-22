"use client";

import { PositionForm } from "@/components/PositionForm";
import { useRouter } from "next/navigation";

export default function NewPositionPage() {
  const router = useRouter();

  const handleSubmit = async (position: any) => {
    try {
      const response = await fetch("/api/positions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(position),
      });

      if (!response.ok) {
        throw new Error("Failed to create position");
      }

      // Redirect to dashboard after successful creation
      router.push("/dashboard");
    } catch (error) {
      console.error("Error creating position:", error);
      // TODO: Add error handling UI
    }
  };

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-8">Create New Position</h1>
      <PositionForm onSubmit={handleSubmit} />
    </div>
  );
}
