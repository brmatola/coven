#!/bin/bash
# Generate TypeScript client from OpenAPI specification
# This script is part of the api-spec package build process

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_SPEC_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OPENAPI_SPEC="$API_SPEC_DIR/openapi.yaml"
BUNDLED_SPEC="$API_SPEC_DIR/openapi.bundled.yaml"
OUTPUT_DIR="$API_SPEC_DIR/generated/ts"

# Check if OpenAPI spec exists
if [ ! -f "$OPENAPI_SPEC" ]; then
    echo "❌ OpenAPI specification not found: $OPENAPI_SPEC"
    exit 1
fi

# Check if openapi-typescript-codegen is available
if ! command -v npx &> /dev/null; then
    echo "❌ npx is not available. Please install Node.js"
    exit 1
fi

# Bundle the OpenAPI spec first to resolve all $refs
echo "📦 Bundling OpenAPI spec to resolve references..."
npx @redocly/cli bundle "$OPENAPI_SPEC" -o "$BUNDLED_SPEC" || {
    echo "❌ Failed to bundle OpenAPI spec"
    exit 1
}

# Create output directory
mkdir -p "$OUTPUT_DIR"

# Generate TypeScript client from bundled spec
echo "📦 Generating TypeScript client from bundled OpenAPI spec..."
echo "   Input: $BUNDLED_SPEC"
echo "   Output: $OUTPUT_DIR"

npx --yes openapi-typescript-codegen \
    --input "$BUNDLED_SPEC" \
    --output "$OUTPUT_DIR" \
    --client axios \
    --useOptions \
    --exportCore true \
    --exportServices true \
    --exportModels true \
    --exportSchemas false

if [ $? -eq 0 ]; then
    echo "✅ TypeScript client generated successfully"
    echo "   Output: $OUTPUT_DIR"
else
    echo "❌ Failed to generate TypeScript client"
    exit 1
fi
