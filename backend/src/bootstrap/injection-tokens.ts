/** DI 令牌：端口为纯类型接口，装配层使用符号令牌绑定实现。 */
export const TOKENS = {
  PgPool: Symbol('PG_POOL'),
  Clock: Symbol('CLOCK'),
  AdminRepository: Symbol('ADMIN_REPOSITORY'),
  SessionRepository: Symbol('SESSION_REPOSITORY'),
  PasswordHasher: Symbol('PASSWORD_HASHER'),
  AdminTokenService: Symbol('ADMIN_TOKEN_SERVICE'),
  LoginThrottle: Symbol('LOGIN_THROTTLE'),
  OperationLogRepository: Symbol('OPERATION_LOG_REPOSITORY'),
  ImageStorage: Symbol('IMAGE_STORAGE'),
  MediaRepository: Symbol('MEDIA_REPOSITORY'),
  MediaUrlBuilder: Symbol('MEDIA_URL_BUILDER'),
  ImageInspector: Symbol('IMAGE_INSPECTOR'),
  ProductRepository: Symbol('PRODUCT_REPOSITORY'),
  StockRepository: Symbol('STOCK_REPOSITORY'),
  AddressRepository: Symbol('ADDRESS_REPOSITORY')
} as const;
