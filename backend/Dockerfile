# Multi-stage build for the Relay.Api backend.
#
# IMPORTANT: the build context for this Dockerfile MUST be the repository root
# (see docker-compose.yaml: `context: .`, `dockerfile: backend/Dockerfile`), NOT
# `backend/`. Relay.Api.csproj links `..\..\seed.sql` as Content copied to the
# output directory (`<Content Include="..\..\seed.sql" Link="seed.sql" .../>`),
# so the repo-root seed.sql must be visible at build time, two levels above the
# csproj, or `dotnet publish` cannot resolve the link and the app throws at
# startup when SeedImporter looks for seed.sql next to the assembly.
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy the whole backend tree and the seed.sql the csproj links to. (.dockerignore
# at the repo root strips bin/obj/node_modules/dist so this stays a fast copy.)
COPY backend/ backend/
COPY seed.sql seed.sql

RUN dotnet restore backend/Relay.Api/Relay.Api.csproj
RUN dotnet publish backend/Relay.Api/Relay.Api.csproj -c Release -o /app/publish --no-restore

# Fail the build loudly if seed.sql didn't make it into the publish output,
# instead of failing quietly at container startup.
RUN test -f /app/publish/seed.sql || (echo "seed.sql missing from publish output" >&2 && exit 1)

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
COPY --from=build /app/publish .

# Demo stack: keep Swagger available (see ASPNETCORE_ENVIRONMENT=Development in
# docker-compose.yaml) and listen on the port compose maps to host 8081.
ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "Relay.Api.dll"]
