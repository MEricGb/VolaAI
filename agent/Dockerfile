# Build context must be the repo root (not agent/) so proto/ is accessible
FROM rust:1.82-slim AS builder
RUN apt-get update && apt-get install -y protobuf-compiler && rm -rf /var/lib/apt/lists/*
WORKDIR /build
# Copy full repo so build.rs can find ../proto/ (i.e. /build/proto/)
COPY . .
WORKDIR /build/agent
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/agent/target/release/agent /usr/local/bin/agent
EXPOSE 50052
CMD ["agent"]
