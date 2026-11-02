FROM maven:3.9.9-eclipse-temurin-17 AS build
WORKDIR /workspace
COPY pom.xml .
COPY src ./src
RUN mvn -q -DskipTests package

FROM flink:1.20.2-scala_2.12-java17
COPY --from=build /workspace/target/bayno-flink-demo.jar /opt/flink/usrlib/bayno-flink-demo.jar
