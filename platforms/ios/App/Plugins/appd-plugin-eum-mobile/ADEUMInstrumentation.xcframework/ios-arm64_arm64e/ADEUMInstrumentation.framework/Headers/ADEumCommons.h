//  Copyright (c) 2015 AppDynamics Technologies. All rights reserved.

#if __has_feature(nullability)
#   define ADEUM_ASSUME_NONNULL_BEGIN NS_ASSUME_NONNULL_BEGIN
#   define ADEUM_ASSUME_NONNULL_END NS_ASSUME_NONNULL_END
#   define ADEUM_NULLABLE __nullable
#else
#   define ADEUM_ASSUME_NONNULL_BEGIN
#   define ADEUM_ASSUME_NONNULL_END
#   define ADEUM_NULLABLE
#endif

#if !defined(SWIFT_METATYPE) 
# define SWIFT_METATYPE(X) Class
#endif

# if __has_attribute(warn_unused_result)
#  define SWIFT_WARN_UNUSED_RESULT __attribute__((warn_unused_result))
# else
#  define SWIFT_WARN_UNUSED_RESULT
# endif
