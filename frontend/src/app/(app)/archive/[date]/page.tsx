import { ArchiveRoute } from "@/features/archive/ArchiveRoute";

export default async function ArchiveDatePage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  return <ArchiveRoute date={date} />;
}
