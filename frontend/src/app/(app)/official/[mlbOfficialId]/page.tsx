import { OfficialRoute } from "@/features/official/OfficialRoute";

export default async function OfficialPage({
  params,
}: {
  params: Promise<{ mlbOfficialId: string }>;
}) {
  const { mlbOfficialId } = await params;
  return <OfficialRoute mlbOfficialId={Number(mlbOfficialId)} />;
}
