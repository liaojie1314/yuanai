// vitest 全局 setup 占位。当前 mobile 单测只覆盖平台无关的纯逻辑模块，
// 不引入 DOM 断言或原生渲染器；如果后续加入 React Native Testing Library
// 组件测试，再在此接入相应的 setup。
export {}
