-- Voyages - Schéma adapté pour PostgreSQL/SQLite
-- Source : s47-td7-intension-et-extension-voyages.sql (Oracle V1.6.0)

DROP TABLE IF EXISTS Reservation;
DROP TABLE IF EXISTS Carac;
DROP TABLE IF EXISTS Planning;
DROP TABLE IF EXISTS OptionV;
DROP TABLE IF EXISTS Client;
DROP TABLE IF EXISTS Voyage;

CREATE TABLE Voyage (
    idV         INTEGER,
    villeArr    VARCHAR(20),
    paysArr     VARCHAR(20),
    villeDep    VARCHAR(20),
    hotel       VARCHAR(20),
    nbEtoiles   SMALLINT,
    duree       SMALLINT NOT NULL,
    CONSTRAINT pk_Voyage PRIMARY KEY (idV)
);

CREATE TABLE Client (
    numCl       INTEGER,
    nom         VARCHAR(25),
    prenom      VARCHAR(20),
    adresse     VARCHAR(40),
    cp          VARCHAR(5),
    ville       VARCHAR(20),
    categorie   VARCHAR(15),
    CONSTRAINT pk_Client PRIMARY KEY (numCl),
    CONSTRAINT uk_Client_01 UNIQUE (nom, prenom)
);

CREATE TABLE OptionV (
    code        INTEGER,
    libelle     VARCHAR(20),
    CONSTRAINT pk_OptionV PRIMARY KEY (code),
    CONSTRAINT uk_OptionV_01 UNIQUE (libelle)
);

CREATE TABLE Planning (
    idV         INTEGER,
    dateDep     DATE,
    tarif       NUMERIC(6,2),
    CONSTRAINT pk_Planning PRIMARY KEY (idV, dateDep),
    CONSTRAINT fk_Planning_Voyage FOREIGN KEY (idV) REFERENCES Voyage(idV)
);

CREATE TABLE Carac (
    idV         INTEGER,
    code        INTEGER,
    prix        NUMERIC(6,2),
    CONSTRAINT pk_Carac PRIMARY KEY (idV, code),
    CONSTRAINT fk_Carac_Voyage  FOREIGN KEY (idV)  REFERENCES Voyage(idV),
    CONSTRAINT fk_Carac_OptionV FOREIGN KEY (code) REFERENCES OptionV(code)
);

CREATE TABLE Reservation (
    numCl       INTEGER,
    idV         INTEGER,
    dateDep     DATE,
    nbPers      SMALLINT,
    dateRes     DATE,
    CONSTRAINT pk_Reservation PRIMARY KEY (numCl, idV, dateDep),
    CONSTRAINT fk_Reservation_Planning FOREIGN KEY (idV, dateDep) REFERENCES Planning(idV, dateDep),
    CONSTRAINT fk_Reservation_Client   FOREIGN KEY (numCl)        REFERENCES Client(numCl)
);
