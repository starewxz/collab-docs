import { Spinner } from "@/components/ui";

export default function Loading() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Spinner label="Loading" />
    </div>
  );
}
