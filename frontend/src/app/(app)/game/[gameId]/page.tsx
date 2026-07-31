import { GameRoute } from "@/features/match/GameRoute";

export default async function GamePage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  return <GameRoute gameId={gameId} />;
}
