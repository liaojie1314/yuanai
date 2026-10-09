"""人格候选项的预筛：纯函数，不触库也不调模型。"""

from app.services.persona_candidate_service import looks_like_style_correction


def test_cue_words_hit() -> None:
    """明显的表达方式纠正能被预筛命中。"""

    assert looks_like_style_correction("别这么啰嗦")
    assert looks_like_style_correction("以后叫我老板")


def test_long_message_is_not_a_style_correction() -> None:
    """长消息不入队：预筛的意义就是把模型调用挡在门外。"""

    assert not looks_like_style_correction("语气" + "啊" * 200)


def test_unrelated_message_is_skipped() -> None:
    """不含线索词的消息零开销跳过。"""

    assert not looks_like_style_correction("帮我写个快排")


def test_blank_message_is_skipped() -> None:
    """空白消息不是纠正。"""

    assert not looks_like_style_correction("   ")
