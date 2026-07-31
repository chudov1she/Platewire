-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "mlbTeamId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "abbreviation" TEXT NOT NULL,
    "teamName" TEXT,
    "locationName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Venue" (
    "id" TEXT NOT NULL,
    "mlbVenueId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL,
    "mlbGamePk" INTEGER NOT NULL,
    "season" INTEGER,
    "gameDateUtc" TIMESTAMP(3) NOT NULL,
    "officialDate" DATE NOT NULL,
    "status" TEXT NOT NULL,
    "statusDetail" TEXT,
    "homeScore" INTEGER,
    "awayScore" INTEGER,
    "inning" INTEGER,
    "inningHalf" TEXT,
    "inningState" TEXT,
    "balls" INTEGER,
    "strikes" INTEGER,
    "outs" INTEGER,
    "dayNight" TEXT,
    "scheduledInnings" INTEGER,
    "weatherCondition" TEXT,
    "weatherTemp" TEXT,
    "weatherWind" TEXT,
    "winlineEventId" INTEGER,
    "winlineFlipped" BOOLEAN,
    "fetchedAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "venueId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeatherObservation" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "venueId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'open_meteo',
    "observedAt" TIMESTAMP(3) NOT NULL,
    "relativeToGame" TEXT,
    "temperatureF" DOUBLE PRECISION,
    "apparentTemperatureF" DOUBLE PRECISION,
    "humidity" DOUBLE PRECISION,
    "dewPointF" DOUBLE PRECISION,
    "pressureHpa" DOUBLE PRECISION,
    "precipitationIn" DOUBLE PRECISION,
    "cloudCover" DOUBLE PRECISION,
    "windSpeedMph" DOUBLE PRECISION,
    "windGustsMph" DOUBLE PRECISION,
    "windDirectionDeg" DOUBLE PRECISION,
    "weatherCode" INTEGER,
    "conditionText" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeatherObservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Team_mlbTeamId_key" ON "Team"("mlbTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "Venue_mlbVenueId_key" ON "Venue"("mlbVenueId");

-- CreateIndex
CREATE UNIQUE INDEX "Game_mlbGamePk_key" ON "Game"("mlbGamePk");

-- CreateIndex
CREATE INDEX "Game_officialDate_idx" ON "Game"("officialDate");

-- CreateIndex
CREATE INDEX "Game_status_gameDateUtc_idx" ON "Game"("status", "gameDateUtc");

-- CreateIndex
CREATE INDEX "Game_winlineEventId_idx" ON "Game"("winlineEventId");

-- CreateIndex
CREATE INDEX "WeatherObservation_gameId_observedAt_idx" ON "WeatherObservation"("gameId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WeatherObservation_gameId_source_observedAt_key" ON "WeatherObservation"("gameId", "source", "observedAt");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeatherObservation" ADD CONSTRAINT "WeatherObservation_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeatherObservation" ADD CONSTRAINT "WeatherObservation_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
