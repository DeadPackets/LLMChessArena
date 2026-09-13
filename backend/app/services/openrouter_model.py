from functools import lru_cache

from pydantic_ai.models.openrouter import OpenRouterModel, OpenRouterStreamedResponse
from pydantic_ai.providers.openrouter import OpenRouterProvider

from app.config import OPENROUTER_API_KEY


def _reported_usage(response) -> dict:
    usage = response.usage
    if usage is None:
        return {}
    cache = usage.prompt_tokens_details
    return {"arena_usage": {
        "input_tokens": usage.prompt_tokens,
        "output_tokens": usage.completion_tokens,
        "cache_read_tokens": cache.cached_tokens if cache else None,
        "cache_write_tokens": getattr(cache, "cache_write_tokens", None) if cache else None,
        "cost_usd": usage.cost,
    }}


class ArenaStreamedResponse(OpenRouterStreamedResponse):
    def _map_usage(self, chunk):
        self.provider_details = {**(self.provider_details or {}), **_reported_usage(chunk)}
        if chunk.provider:
            self.provider_details["downstream_provider"] = chunk.provider
        return super()._map_usage(chunk)


class ArenaOpenRouterModel(OpenRouterModel):
    # SDK 2.43 normalizes absent cache fields to zero and omits zero-dollar cost.
    def _process_provider_details(self, response):
        return {**(super()._process_provider_details(response) or {}), **_reported_usage(response)}

    @property
    def _streamed_response_cls(self):
        return ArenaStreamedResponse


@lru_cache(maxsize=1)
def openrouter_provider() -> OpenRouterProvider:
    provider = OpenRouterProvider(api_key=OPENROUTER_API_KEY)
    provider.client.max_retries = 0
    return provider


def arena_model(model_name: str) -> ArenaOpenRouterModel:
    return ArenaOpenRouterModel(model_name, provider=openrouter_provider())
