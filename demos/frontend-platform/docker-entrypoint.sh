#!/bin/sh
# Inject the runtime AI agent URL into the built JS bundle.
# Vite bakes VITE_AI_AGENT_ENDPOINT into the bundle at build time, so we use
# a placeholder that gets replaced here with the actual Cloud Run service URL.
if [ -n "${VITE_AI_AGENT_ENDPOINT:-}" ]; then
    find /usr/share/nginx/html -name "*.js" -exec \
        sed -i "s|RUNTIME_REPLACE_AI_AGENT_ENDPOINT|${VITE_AI_AGENT_ENDPOINT}|g" {} \;
    echo "Injected VITE_AI_AGENT_ENDPOINT: ${VITE_AI_AGENT_ENDPOINT}"
fi
