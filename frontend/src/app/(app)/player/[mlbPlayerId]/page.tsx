import { PlayerRoute } from "@/features/player/PlayerRoute";

export default async function PlayerPage({
  params,
}: {
  params: Promise<{ mlbPlayerId: string }>;
}) {
  const { mlbPlayerId } = await params;
  return <PlayerRoute mlbPlayerId={Number(mlbPlayerId)} />;
}
