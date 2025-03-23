"use client";

import { PositionForm } from "@/components/PositionForm";
import { useRouter } from "next/navigation";

export default function NewPositionPage() {
  const router = useRouter();

  const handleSubmit = async (position: any) => {
    // Position has already been created by PositionForm
    // Just redirect to dashboard
    router.push("/dashboard");
  };

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-8">Create New Position</h1>
      <PositionForm onSubmit={handleSubmit} />
    </div>
  );
}
