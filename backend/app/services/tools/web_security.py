"""联网工具共享的 URL、SSRF 和 HTML 边界。"""

from __future__ import annotations

import ipaddress
import re
import socket
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx

_MAX_HTML_CHARS = 100_000
_BLOCKED_HOSTS = {"localhost", "localhost.localdomain", "metadata.google.internal"}
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


class UrlPolicyError(ValueError):
    """URL 不满足外部联网工具的安全策略。"""


def _is_private_address(value: str) -> bool:
    """判断 IP 是否指向本机、内网或云元数据等非公开地址。"""

    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    return bool(
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_multicast
        or address.is_unspecified
    )


def validate_public_url(value: str) -> str:
    """校验只允许 HTTPS 公网地址，并阻断解析后的内网目标。"""

    if _CONTROL_CHARS.search(value):
        raise UrlPolicyError("URL contains control characters")
    parsed = urlsplit(value.strip())
    hostname = parsed.hostname
    if (
        parsed.scheme != "https"
        or not hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise UrlPolicyError("Only credential-free HTTPS URLs are allowed")
    normalized_host = hostname.rstrip(".").lower()
    if normalized_host in _BLOCKED_HOSTS or _is_private_address(normalized_host):
        raise UrlPolicyError("Private or metadata addresses are blocked")
    try:
        addresses: set[str] = {
            str(item[4][0])
            for item in socket.getaddrinfo(
                normalized_host, parsed.port or 443, type=socket.SOCK_STREAM
            )
        }
    except socket.gaierror as error:
        raise UrlPolicyError("URL host cannot be resolved") from error
    if not addresses or any(_is_private_address(address) for address in addresses):
        raise UrlPolicyError("Resolved URL points to a private address")
    return value.strip()


class _VisibleTextParser(HTMLParser):
    """提取正文文本和有限链接，忽略脚本、样式与隐藏节点。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.links: list[dict[str, str]] = []
        self._ignored_depth = 0
        self._current_link: dict[str, str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() in {"script", "style", "noscript", "template", "svg"}:
            self._ignored_depth += 1
            return
        if tag.lower() == "a":
            href = next((value for key, value in attrs if key.lower() == "href" and value), None)
            if href:
                self._current_link = {"href": href, "text": ""}

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style", "noscript", "template", "svg"}:
            self._ignored_depth = max(0, self._ignored_depth - 1)
            return
        if tag.lower() == "a" and self._current_link is not None:
            if self._current_link["text"].strip():
                self.links.append(self._current_link)
            self._current_link = None

    def handle_data(self, data: str) -> None:
        if self._ignored_depth > 0:
            return
        cleaned = " ".join(data.split())
        if not cleaned:
            return
        self.parts.append(cleaned)
        if self._current_link is not None:
            self._current_link["text"] += f" {cleaned}"


def parse_html_document(html: str, *, base_url: str) -> dict[str, object]:
    """把不可信 HTML 转为有界文本、标题和可继续导航的链接。"""

    parser = _VisibleTextParser()
    parser.feed(html[:_MAX_HTML_CHARS])
    title = ""
    title_match = re.search(r"<title[^>]*>(.*?)</title>", html[:_MAX_HTML_CHARS], re.I | re.S)
    if title_match:
        title = " ".join(re.sub(r"<[^>]+>", "", title_match.group(1)).split())[:200]
    links: list[dict[str, str]] = []
    for link in parser.links[:100]:
        try:
            href = validate_public_url(urljoin(base_url, link["href"]))
        except UrlPolicyError:
            continue
        links.append({"text": link["text"].strip()[:200], "url": href})
    return {
        "title": title,
        "text": " ".join(parser.parts)[:_MAX_HTML_CHARS],
        "links": links,
        "source_url": base_url,
    }


async def fetch_public_html(url: str, *, timeout: float = 15.0) -> tuple[str, str]:
    """获取公网 HTML，并在重定向的每一跳上重复 SSRF 校验。"""

    current = validate_public_url(url)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
        for _ in range(4):
            response = await client.get(
                current, headers={"Accept": "text/html,application/xhtml+xml"}
            )
            if response.is_redirect:
                location = response.headers.get("location")
                if not location:
                    raise UrlPolicyError("Redirect location is missing")
                current = validate_public_url(urljoin(current, location))
                continue
            response.raise_for_status()
            content_type = response.headers.get("content-type", "")
            if "html" not in content_type and "text/plain" not in content_type:
                raise UrlPolicyError("Only HTML documents are supported")
            return current, response.text[:_MAX_HTML_CHARS]
    raise UrlPolicyError("Too many redirects")
