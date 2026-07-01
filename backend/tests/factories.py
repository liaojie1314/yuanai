"""测试数据工厂 — 使用 factory-boy 生成测试对象。"""

import uuid

import factory

from app.core.security import hash_password
from app.models.conversation import Conversation
from app.models.user import User


class UserFactory(factory.Factory):
    class Meta:
        model = User

    id = factory.LazyFunction(uuid.uuid4)
    email = factory.Sequence(lambda n: f"user{n}@example.com")
    username = factory.Sequence(lambda n: f"user{n}")
    hashed_password = factory.LazyFunction(lambda: hash_password("Test1234!"))
    avatar_url = None


class ConversationFactory(factory.Factory):
    class Meta:
        model = Conversation

    id = factory.LazyFunction(uuid.uuid4)
    title = "测试对话"
    model = "gpt-4o"
    is_pinned = False
