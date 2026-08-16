from app.services.tools import search


def test_auto_configuration_prioritizes_healthy_searxng() -> None:
    capability = search.resolve_search_provider(
        settings_provider="auto",
        health={"searxng": True, "brave": True, "tavily": True},
    )

    assert capability.enabled is True
    assert capability.provider == "searxng"
    assert capability.reason is None


def test_explicit_provider_never_falls_back_to_another_provider() -> None:
    capability = search.resolve_search_provider(
        settings_provider="brave",
        health={"searxng": True, "brave": False, "tavily": True},
    )

    assert capability.enabled is False
    assert capability.provider == "brave"
    assert capability.reason == "unavailable"


def test_disabled_configuration_exposes_no_provider() -> None:
    capability = search.resolve_search_provider(settings_provider="disabled", health={})

    assert capability.enabled is False
    assert capability.provider is None
    assert capability.reason == "disabled"
